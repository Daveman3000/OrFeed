'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { strFromU8, unzipSync } = require('fflate');
const SurfacePackageCore = require('../surface-package-core-v001.js');

const INDEX_FILE = 'registry.json';
const PACKAGES_DIR = 'packages';
const CSV_MEMBER = 'surface.semantic.csv';
const DESCRIPTOR_MEMBER = 'surface_descriptor.json';
const SURFACE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function fail(message) {
  throw new Error(message);
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function defaultSurfaceId(packagePath) {
  const name = path.basename(packagePath).replace(/\.surface\.zip$/i, '');
  if (!SURFACE_ID_PATTERN.test(name)) {
    fail(`Package filename cannot seed a valid surface_id: ${JSON.stringify(name)}.`);
  }
  return name;
}

function validateSurfaceId(surfaceId) {
  if (typeof surfaceId !== 'string' || !SURFACE_ID_PATTERN.test(surfaceId)) {
    fail('surface_id must start with an alphanumeric character and contain only letters, numbers, dot, underscore, or hyphen.');
  }
  return surfaceId;
}

function resolveRegistryRoot(cliRoot, env = process.env) {
  const selected = cliRoot || env.SURFACE_ANALYZER_REGISTRY;
  if (!selected) {
    fail('Registry root is required. Pass --registry <path> or set SURFACE_ANALYZER_REGISTRY.');
  }
  return path.resolve(selected);
}

function emptyIndex() {
  return { schema_version: 1, surfaces: {} };
}

function validateIndex(index) {
  if (!index || index.schema_version !== 1 || !index.surfaces || typeof index.surfaces !== 'object' || Array.isArray(index.surfaces)) {
    fail(`${INDEX_FILE} must contain schema_version 1 and a surfaces object.`);
  }
  for (const [surfaceId, record] of Object.entries(index.surfaces)) {
    validateSurfaceId(surfaceId);
    if (!record || typeof record !== 'object') fail(`${surfaceId}: registry record must be an object.`);
    if (typeof record.path !== 'string' || !record.path) fail(`${surfaceId}: registry path is required.`);
    if (!/^[a-f0-9]{64}$/.test(record.sha256 || '')) fail(`${surfaceId}: registry sha256 is invalid.`);
    if (typeof record.study_id !== 'string' || !record.study_id) fail(`${surfaceId}: registry study_id is required.`);
    if (typeof record.registered_at !== 'string' || !record.registered_at) fail(`${surfaceId}: registry registered_at is required.`);
  }
  return index;
}

function readIndex(registryRoot) {
  const indexPath = path.join(registryRoot, INDEX_FILE);
  if (!fs.existsSync(indexPath)) return emptyIndex();
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
  } catch (error) {
    fail(`Cannot read ${indexPath}: ${error.message}`);
  }
  return validateIndex(parsed);
}

function writeIndex(registryRoot, index) {
  fs.mkdirSync(registryRoot, { recursive: true });
  const indexPath = path.join(registryRoot, INDEX_FILE);
  const tempPath = `${indexPath}.${process.pid}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(index, null, 2)}\n`, { flag: 'wx' });
  fs.renameSync(tempPath, indexPath);
}

function canonicalPackageMembers(bytes, packagePath) {
  let extracted;
  try {
    const wanted = new Set([CSV_MEMBER, DESCRIPTOR_MEMBER]);
    extracted = unzipSync(bytes, { filter: file => wanted.has(file.name) });
  } catch (error) {
    fail(`${packagePath}: invalid ZIP package: ${error.message}`);
  }
  const csv = extracted[CSV_MEMBER];
  const descriptorBytes = extracted[DESCRIPTOR_MEMBER];
  if (!csv) fail(`${packagePath}: ZIP is missing ${CSV_MEMBER}.`);
  if (!descriptorBytes) fail(`${packagePath}: ZIP is missing ${DESCRIPTOR_MEMBER}.`);
  let descriptor;
  try {
    descriptor = JSON.parse(strFromU8(descriptorBytes));
  } catch (error) {
    fail(`${packagePath}: ${DESCRIPTOR_MEMBER} is invalid JSON: ${error.message}`);
  }
  return { csvText: strFromU8(csv), descriptor };
}

function buildCanonicalSurface(bytes, packagePath) {
  const { csvText, descriptor } = canonicalPackageMembers(bytes, packagePath);
  const surface = SurfacePackageCore.buildSemanticSurface(
    csvText,
    descriptor,
    { name: path.basename(packagePath), size: bytes.length }
  );
  return { surface, descriptor };
}

function safeRegisteredPath(registryRoot, relativePath, surfaceId) {
  if (path.isAbsolute(relativePath)) fail(`${surfaceId}: registry path must be relative.`);
  const absolute = path.resolve(registryRoot, relativePath);
  const prefix = `${path.resolve(registryRoot)}${path.sep}`;
  if (!absolute.startsWith(prefix)) fail(`${surfaceId}: registry path escapes the registry root.`);
  return absolute;
}

function createFilesystemRegistry({ registryRoot } = {}) {
  const root = resolveRegistryRoot(registryRoot);
  const parsedCache = new Map();

  function listSurfaces() {
    const index = readIndex(root);
    return Object.entries(index.surfaces)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([surfaceId, record]) => ({ surface_id: surfaceId, ...record }));
  }

  function registerPackage(packagePath, { surfaceId = null } = {}) {
    const sourcePath = path.resolve(packagePath);
    if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile()) {
      fail(`Surface package does not exist: ${sourcePath}`);
    }
    const id = validateSurfaceId(surfaceId || defaultSurfaceId(sourcePath));
    const bytes = fs.readFileSync(sourcePath);
    const packageHash = sha256(bytes);
    const { surface, descriptor } = buildCanonicalSurface(bytes, sourcePath);
    const index = readIndex(root);
    const existing = index.surfaces[id];
    if (existing && existing.sha256 !== packageHash) {
      fail(`surface_id ${id} already maps to SHA-256 ${existing.sha256}; refusing different SHA-256 ${packageHash}.`);
    }

    fs.mkdirSync(path.join(root, PACKAGES_DIR), { recursive: true });
    const relativePath = path.posix.join(PACKAGES_DIR, `${packageHash}.surface.zip`);
    const destinationPath = safeRegisteredPath(root, relativePath, id);
    if (fs.existsSync(destinationPath)) {
      const storedHash = sha256(fs.readFileSync(destinationPath));
      if (storedHash !== packageHash) fail(`${destinationPath}: stored package bytes do not match its immutable filename.`);
    } else {
      fs.copyFileSync(sourcePath, destinationPath, fs.constants.COPYFILE_EXCL);
    }

    const record = existing || {
      path: relativePath,
      sha256: packageHash,
      study_id: descriptor.study_id,
      registered_at: new Date().toISOString()
    };
    if (!existing) {
      index.surfaces[id] = record;
      writeIndex(root, index);
    }
    parsedCache.set(packageHash, surface);
    return { surface_id: id, ...record };
  }

  function resolveSurface(surfaceId) {
    const id = validateSurfaceId(surfaceId);
    const index = readIndex(root);
    const record = index.surfaces[id];
    if (!record) fail(`Unknown surface_id ${id}.`);
    const packagePath = safeRegisteredPath(root, record.path, id);
    if (!fs.existsSync(packagePath)) fail(`${id}: registered package is missing at ${packagePath}.`);
    const bytes = fs.readFileSync(packagePath);
    const actualHash = sha256(bytes);
    if (actualHash !== record.sha256) {
      fail(`${id}: package SHA-256 mismatch; expected ${record.sha256}, got ${actualHash}.`);
    }
    if (parsedCache.has(actualHash)) return parsedCache.get(actualHash);
    const { surface } = buildCanonicalSurface(bytes, packagePath);
    parsedCache.set(actualHash, surface);
    return surface;
  }

  return {
    registryRoot: root,
    registerPackage,
    resolveSurface,
    listSurfaces
  };
}

function parseRegisterArguments(argv, env = process.env) {
  const args = [...argv];
  if (args.shift() !== 'register') fail('Usage: surface-registry-v001.cjs register [--registry <path>] [--surface-id <id>] <package.surface.zip>');
  let cliRoot = null;
  let surfaceId = null;
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--registry' || arg === '--surface-id') {
      const value = args[++i];
      if (!value) fail(`${arg} requires a value.`);
      if (arg === '--registry') cliRoot = value;
      else surfaceId = value;
    } else if (arg.startsWith('--')) {
      fail(`Unknown option ${arg}.`);
    } else {
      positional.push(arg);
    }
  }
  if (positional.length !== 1) fail('Registration requires exactly one .surface.zip package path.');
  return {
    registryRoot: resolveRegistryRoot(cliRoot, env),
    surfaceId,
    packagePath: positional[0]
  };
}

function main() {
  try {
    const options = parseRegisterArguments(process.argv.slice(2));
    const registry = createFilesystemRegistry({ registryRoot: options.registryRoot });
    const result = registry.registerPackage(options.packagePath, { surfaceId: options.surfaceId });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = {
  INDEX_FILE,
  PACKAGES_DIR,
  CSV_MEMBER,
  DESCRIPTOR_MEMBER,
  sha256,
  defaultSurfaceId,
  resolveRegistryRoot,
  createFilesystemRegistry,
  parseRegisterArguments
};
