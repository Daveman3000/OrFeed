'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createFilesystemRegistry, resolveRegistryRoot } = require('./surface-registry-v001.cjs');

const POLICY_PATH = path.join(__dirname, '..', 'policies', 'exploratory', 'tuning-policy-mostly-dead-v001.json');
const REQUIRED_CLASSIFICATIONS = new Set(['PARAMETER_SHAPE_ADEQUACY', 'BOUNDED_RESCUE', 'STOP_FAMILY']);

function fail(message) {
  throw new Error(message);
}

function loadPolicy(policyPath = POLICY_PATH) {
  const policy = JSON.parse(fs.readFileSync(policyPath, 'utf8'));
  if (policy.policy_type !== 'tuning_policy_exploratory_calibration' || policy.authoritative !== false || policy.frozen !== false) {
    fail('Pressure-test policy must be explicitly exploratory, non-authoritative, and unfrozen.');
  }
  if (!policy.primary_performance_metric || !policy.sanity_metrics || !policy.quantiles) {
    fail('Pressure-test policy is missing required metrics or quantile semantics.');
  }
  if (!Array.isArray(policy.classifications) || policy.classifications.some(value => !REQUIRED_CLASSIFICATIONS.has(value))) {
    fail('Pressure-test policy contains an unsupported classification.');
  }
  return policy;
}

function parseArguments(argv, env = process.env) {
  const args = [...argv];
  let cliRoot = null;
  let surfaceId = null;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--registry' || arg === '--surface-id') {
      const value = args[++i];
      if (!value) fail(`${arg} requires a value.`);
      if (arg === '--registry') cliRoot = value;
      else surfaceId = value;
    } else {
      fail(`Unknown argument ${arg}.`);
    }
  }
  if (!surfaceId) {
    fail('Usage: pressure-test-mostly-dead-v001.cjs [--registry <path>] --surface-id <id>');
  }
  return { registryRoot: resolveRegistryRoot(cliRoot, env), surfaceId };
}

function quantile(values, q) {
  if (!Number.isFinite(q) || q < 0 || q > 1) fail('Quantile q must be between 0 and 1.');
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const x = (sorted.length - 1) * q;
  const lo = Math.floor(x);
  const hi = Math.ceil(x);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (x - lo);
}

function summarizeDistribution(values) {
  const q1 = quantile(values, 0.25);
  const median = quantile(values, 0.50);
  const q3 = quantile(values, 0.75);
  if (median === null) return null;
  return { q1, median, q3, iqr: q3 - q1 };
}

function compare(value, rule) {
  if (rule.operator === '>') return value > rule.value;
  fail(`Unsupported sanity operator ${rule.operator}.`);
}

function parameterValue(definition, index) {
  return index < 0 ? null : definition.values[index];
}

function contextObject(definitions, indices, cell) {
  return Object.fromEntries(definitions.map(definition => [
    definition.id,
    parameterValue(definition, indices[definition.id][cell])
  ]));
}

function contextId(context) {
  const entries = Object.entries(context);
  return entries.length ? entries.map(([key, value]) => `${key}=${JSON.stringify(value)}`).join('|') : 'all';
}

function coordinateKey(indices, orderedDefinitions, cell) {
  return orderedDefinitions.map(definition => indices[definition.id][cell]).join(',');
}

function coherentMinimumCells(nEvaluable, policy) {
  const rule = policy.mostly_dead.coherent_survival.minimum_component_cells;
  return nEvaluable < rule.when_n_evaluable_below
    ? Math.max(rule.small_domain_fixed_minimum, Math.ceil(rule.small_domain_fraction * nEvaluable))
    : rule.otherwise;
}

function minimumBoundaryComponentSupport(nEvaluable, policy = loadPolicy()) {
  const rule = policy.edge_rescue.minimum_boundary_component_support;
  return Math.max(
    Math.min(rule.small_domain_cap, Math.ceil(rule.small_domain_fraction * nEvaluable)),
    Math.ceil(rule.overall_fraction * nEvaluable)
  );
}

function minimumLevelSupport(nEvaluable, policy = loadPolicy()) {
  const rule = policy.edge_rescue.minimum_level_support;
  return Math.max(rule.fixed_minimum, Math.ceil(rule.overall_fraction * nEvaluable));
}

function connectedComponents(saneCells, indices, orderedDefinitions) {
  const cellByCoordinate = new Map();
  for (const cell of saneCells) {
    const key = coordinateKey(indices, orderedDefinitions, cell);
    if (cellByCoordinate.has(key)) fail(`Duplicate ordered coordinate ${key} within a fixed family context.`);
    cellByCoordinate.set(key, cell);
  }

  const visited = new Set();
  const components = [];
  for (const seed of [...saneCells].sort((a, b) => a - b)) {
    if (visited.has(seed)) continue;
    const cells = [];
    const queue = [seed];
    visited.add(seed);
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const cell = queue[cursor];
      cells.push(cell);
      const base = orderedDefinitions.map(definition => indices[definition.id][cell]);
      for (let dimension = 0; dimension < orderedDefinitions.length; dimension++) {
        const current = base[dimension];
        if (current < 0) continue;
        const maximum = orderedDefinitions[dimension].values.length - 1;
        for (const delta of [-1, 1]) {
          const next = current + delta;
          if (next < 0 || next > maximum) continue;
          const neighbor = [...base];
          neighbor[dimension] = next;
          const neighborCell = cellByCoordinate.get(neighbor.join(','));
          if (neighborCell !== undefined && !visited.has(neighborCell)) {
            visited.add(neighborCell);
            queue.push(neighborCell);
          }
        }
      }
    }
    cells.sort((a, b) => a - b);
    components.push({ id: `component_${components.length + 1}`, cells });
  }
  return components;
}

function testComponentEdge({
  component,
  definition,
  edge,
  indices,
  primaryValues,
  nEvaluable,
  saneDistribution,
  policy
}) {
  const last = definition.values.length - 1;
  const levelIndices = edge === 'max' ? [last - 2, last - 1, last] : [2, 1, 0];
  const edgeIndex = levelIndices[2];
  const touchesEdge = component.cells.some(cell => indices[definition.id][cell] === edgeIndex);
  if (!touchesEdge) return null;

  const levelValues = levelIndices.map(level => component.cells
    .filter(cell => indices[definition.id][cell] === level)
    .map(cell => primaryValues[cell])
    .filter(Number.isFinite));
  const levelSupport = levelValues.map(values => values.length);
  const levelMedians = levelValues.map(values => quantile(values, 0.50));
  const boundarySupportRequired = minimumBoundaryComponentSupport(nEvaluable, policy);
  const levelSupportRequired = minimumLevelSupport(nEvaluable, policy);
  const componentSupportPass = component.cells.length >= boundarySupportRequired;
  const levelSupportPass = levelSupport.every(count => count >= levelSupportRequired);
  const directionalImprovement = levelSupportPass
    && levelMedians[2] > levelMedians[1]
    && levelMedians[2] > levelMedians[0];
  const improvement = levelSupportPass ? levelMedians[2] - levelMedians[0] : null;
  const zeroIqr = policy.edge_rescue.material_improvement.zero_iqr_fallback;
  const requiredImprovement = saneDistribution.iqr === 0
    ? Math.max(zeroIqr.absolute_floor, zeroIqr.median_fraction * Math.abs(saneDistribution.median))
    : policy.edge_rescue.material_improvement.iqr_multiplier * saneDistribution.iqr;
  const materialImprovement = improvement !== null && improvement >= requiredImprovement;

  return {
    component_id: component.id,
    component_cells: component.cells.length,
    component_support_required: boundarySupportRequired,
    component_support_pass: componentSupportPass,
    level_indices: levelIndices,
    level_values: levelIndices.map(index => definition.values[index]),
    level_support: levelSupport,
    level_support_required: levelSupportRequired,
    level_support_pass: levelSupportPass,
    level_medians: levelMedians,
    directional_improvement: directionalImprovement,
    observed_improvement: improvement,
    required_improvement: requiredImprovement,
    material_improvement: materialImprovement,
    qualified: componentSupportPass && directionalImprovement && materialImprovement
  };
}

function edgeTests({ components, orderedDefinitions, indices, primaryValues, nEvaluable, saneDistribution, policy }) {
  const tests = {};
  for (const definition of orderedDefinitions) {
    if (definition.values.length < policy.edge_rescue.directional_levels) {
      tests[`${definition.id}:min`] = { supported: false, reason: 'FEWER_THAN_THREE_DECLARED_VALUES', qualified: false };
      tests[`${definition.id}:max`] = { supported: false, reason: 'FEWER_THAN_THREE_DECLARED_VALUES', qualified: false };
      continue;
    }
    for (const edge of ['min', 'max']) {
      const componentTests = components
        .map(component => testComponentEdge({
          component,
          definition,
          edge,
          indices,
          primaryValues,
          nEvaluable,
          saneDistribution,
          policy
        }))
        .filter(Boolean);
      tests[`${definition.id}:${edge}`] = {
        supported: true,
        component_tests: componentTests,
        qualified: componentTests.some(test => test.qualified)
      };
    }
  }
  return tests;
}

function analyzeFamily({ group, surface, policy, definitions }) {
  const metrics = surface.metrics;
  const requiredMetricIds = Object.keys(policy.sanity_metrics);
  const evaluableCells = group.cells.filter(cell => requiredMetricIds.every(id => Number.isFinite(metrics[id][cell])));
  const nLegal = group.cells.length;
  const nEvaluable = evaluableCells.length;
  const missingFraction = nLegal ? (nLegal - nEvaluable) / nLegal : 1;
  const common = {
    family_id: contextId(group.familyContext),
    family_context: group.familyContext,
    population_cells: nLegal,
    evaluable_cells: nEvaluable,
    missing_cells: nLegal - nEvaluable,
    missing_fraction: missingFraction
  };

  if (!nEvaluable || missingFraction > policy.data_support.maximum_missing_fraction) {
    return {
      ...common,
      support_valid: false,
      sane_cells: null,
      sanity_fraction: null,
      coherent_survival: null,
      mostly_dead: null,
      edge_tests: {},
      classification: 'STOP_FAMILY',
      reason: 'INVALID_ANALYSIS_SUPPORT'
    };
  }

  const saneCells = evaluableCells.filter(cell => requiredMetricIds.every(id => compare(metrics[id][cell], policy.sanity_metrics[id])));
  const components = connectedComponents(saneCells, surface.semanticParameterIndices, definitions.ordered);
  const largestComponentCells = components.reduce((largest, component) => Math.max(largest, component.cells.length), 0);
  const sanityFraction = saneCells.length / nEvaluable;
  const componentFraction = largestComponentCells / nEvaluable;
  const componentCellsRequired = coherentMinimumCells(nEvaluable, policy);
  const coherentSurvival = componentFraction >= policy.mostly_dead.coherent_survival.minimum_component_fraction
    && largestComponentCells >= componentCellsRequired;
  const mostlyDead = sanityFraction < policy.mostly_dead.sanity_fraction_below && !coherentSurvival;
  const primaryValues = metrics[policy.primary_performance_metric];
  const saneDistribution = summarizeDistribution(saneCells.map(cell => primaryValues[cell]));
  const tests = mostlyDead && saneDistribution
    ? edgeTests({
      components,
      orderedDefinitions: definitions.ordered,
      indices: surface.semanticParameterIndices,
      primaryValues,
      nEvaluable,
      saneDistribution,
      policy
    })
    : {};
  const rescueQualified = Object.values(tests).some(test => test.qualified);

  return {
    ...common,
    support_valid: true,
    sane_cells: saneCells.length,
    sanity_fraction: sanityFraction,
    largest_sane_component_cells: largestComponentCells,
    largest_sane_component_fraction: componentFraction,
    coherent_component_cells_required: componentCellsRequired,
    coherent_survival: coherentSurvival,
    mostly_dead: mostlyDead,
    sane_primary_metric_distribution: saneDistribution,
    edge_tests: tests,
    classification: !mostlyDead
      ? 'PARAMETER_SHAPE_ADEQUACY'
      : rescueQualified ? 'BOUNDED_RESCUE' : 'STOP_FAMILY',
    reason: !mostlyDead
      ? 'SUFFICIENT_ECONOMIC_SIGNAL'
      : rescueQualified ? 'QUALIFIED_EDGE_EVIDENCE' : 'INSUFFICIENT_VIABLE_PERFORMANCE'
  };
}

function analyzeSurface(surface, { surfaceId = null, surfaceRecord = null, policy = loadPolicy() } = {}) {
  const descriptor = surface && surface.semanticDescriptor;
  if (!descriptor || !surface.semanticParameterIndices || !surface.metrics) fail('Canonical semantic surface is required.');
  const requiredMetrics = [...Object.keys(policy.sanity_metrics), policy.primary_performance_metric];
  for (const id of new Set(requiredMetrics)) if (!surface.metrics[id]) fail(`Surface is missing required metric ${id}.`);

  const definitions = {
    regime: descriptor.parameters.filter(parameter => parameter.topology_role === 'regime'),
    facet: descriptor.parameters.filter(parameter => parameter.topology_role === 'facet'),
    ordered: descriptor.parameters.filter(parameter => parameter.topology_role === 'ordered')
  };
  if (!definitions.ordered.length) fail('Pressure test requires at least one descriptor-defined ordered parameter.');

  const cellCount = surface.metrics[policy.primary_performance_metric].length;
  const groupsByKey = new Map();
  for (let cell = 0; cell < cellCount; cell++) {
    const regimeContext = contextObject(definitions.regime, surface.semanticParameterIndices, cell);
    const familyContext = contextObject(definitions.facet, surface.semanticParameterIndices, cell);
    const key = `${contextId(regimeContext)}::${contextId(familyContext)}`;
    let group = groupsByKey.get(key);
    if (!group) {
      group = { key, regimeContext, familyContext, cells: [], sortKey: [...definitions.regime, ...definitions.facet].map(definition => surface.semanticParameterIndices[definition.id][cell]) };
      groupsByKey.set(key, group);
    }
    group.cells.push(cell);
  }

  const groups = [...groupsByKey.values()].sort((a, b) => {
    for (let i = 0; i < a.sortKey.length; i++) if (a.sortKey[i] !== b.sortKey[i]) return a.sortKey[i] - b.sortKey[i];
    return 0;
  });
  const contextsById = new Map();
  for (const group of groups) {
    const id = contextId(group.regimeContext);
    let context = contextsById.get(id);
    if (!context) {
      context = { regime_context_id: id, regime_context: group.regimeContext, families: [] };
      contextsById.set(id, context);
    }
    context.families.push(analyzeFamily({ group, surface, policy, definitions }));
  }

  const contexts = [...contextsById.values()];
  const classifications = { PARAMETER_SHAPE_ADEQUACY: 0, BOUNDED_RESCUE: 0, STOP_FAMILY: 0 };
  for (const context of contexts) for (const family of context.families) classifications[family.classification]++;
  return {
    schema_version: 1,
    report_type: 'mostly_dead_edge_rescue_pressure_test_v001',
    status: 'post_result_exploratory_non_authoritative',
    surface: {
      surface_id: surfaceId,
      package_sha256: surfaceRecord ? surfaceRecord.sha256 : null,
      study_id: descriptor.study_id,
      configurations: cellCount
    },
    policy: {
      policy_id: policy.policy_id,
      policy_origin: policy.policy_origin,
      authoritative: policy.authoritative,
      frozen: policy.frozen,
      primary_performance_metric: policy.primary_performance_metric,
      quantile_method: policy.quantiles.method
    },
    analysis_scope_id: 'within_family',
    parameter_roles: {
      regimes: definitions.regime.map(parameter => parameter.id),
      facets: definitions.facet.map(parameter => parameter.id),
      ordered: definitions.ordered.map(parameter => parameter.id)
    },
    summary: {
      regime_contexts: contexts.length,
      families: groups.length,
      classifications
    },
    contexts
  };
}

function run(argv = process.argv.slice(2), env = process.env) {
  const options = parseArguments(argv, env);
  const registry = createFilesystemRegistry({ registryRoot: options.registryRoot });
  const surfaceRecord = registry.listSurfaces().find(record => record.surface_id === options.surfaceId);
  if (!surfaceRecord) fail(`Unknown surface_id ${options.surfaceId}.`);
  const surface = registry.resolveSurface(options.surfaceId);
  return analyzeSurface(surface, { surfaceId: options.surfaceId, surfaceRecord });
}

function main() {
  try {
    process.stdout.write(`${JSON.stringify(run(), null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = {
  POLICY_PATH,
  loadPolicy,
  parseArguments,
  quantile,
  summarizeDistribution,
  coherentMinimumCells,
  minimumBoundaryComponentSupport,
  minimumLevelSupport,
  connectedComponents,
  analyzeSurface,
  run
};
