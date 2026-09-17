'use strict';

const fs = require('node:fs');
const path = require('node:path');
const SemanticEngine = require('../semantic-analysis-v030.js');
const ScanEngine = require('../scan-layer-v033.js');
const Session = require('../core/surface-analyzer-session-v001.js');
const FilterEngine = require('../core/surface-filter-engine-v001.js');
const ResearchApi = require('../core/research-api-v001.js');
const { createFilesystemRegistry, resolveRegistryRoot } = require('./surface-registry-v001.cjs');

const METRIC_METADATA = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'metrics.json'), 'utf8'));

function fail(message) {
  throw new Error(message);
}

function parseArguments(argv, env = process.env) {
  const args = [...argv];
  let cliRoot = null;
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--registry') {
      cliRoot = args[++i];
      if (!cliRoot) fail('--registry requires a value.');
    } else if (arg.startsWith('--')) {
      fail(`Unknown option ${arg}.`);
    } else {
      positional.push(arg);
    }
  }
  if (positional.length > 1) fail('Provide at most one request JSON file.');
  return {
    registryRoot: resolveRegistryRoot(cliRoot, env),
    requestPath: positional[0] ? path.resolve(positional[0]) : null
  };
}

function readRequest(requestPath) {
  const text = requestPath ? fs.readFileSync(requestPath, 'utf8') : fs.readFileSync(0, 'utf8');
  if (!text.trim()) fail('Research request JSON is empty.');
  try {
    return JSON.parse(text);
  } catch (error) {
    fail(`Research request is invalid JSON: ${error.message}`);
  }
}

function createApi(registry) {
  return ResearchApi.createResearchApi({
    createSession: Session.createSession,
    resolveSurface: registry.resolveSurface,
    listSurfaces: registry.listSurfaces,
    sessionOptions: {
      semanticEngine: SemanticEngine,
      scanEngine: ScanEngine,
      filterEngine: FilterEngine,
      metricMetadata: METRIC_METADATA
    }
  });
}

async function run(argv = process.argv.slice(2), env = process.env) {
  const options = parseArguments(argv, env);
  const registry = createFilesystemRegistry({ registryRoot: options.registryRoot });
  const request = readRequest(options.requestPath);
  return createApi(registry).execute(request);
}

async function main() {
  try {
    const result = await run();
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = { parseArguments, readRequest, createApi, run };
