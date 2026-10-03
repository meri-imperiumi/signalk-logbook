const test = require('node:test');
const assert = require('node:assert');
const {
  applyDisplayUnits,
  categoryForPath,
  decimalsFromFormat,
  evaluateFormula,
  formatTelemetryValue,
  loadUnitPreferences,
} = require('../src/helpers/units');

// Fixture matching the shape the unitpreferences API serves
function makePrefs() {
  return {
    presetName: 'nautical-metric',
    activePreset: {
      name: 'Nautical metric',
      categories: {
        speed: { baseUnit: 'm/s', targetUnit: 'kn', displayFormat: '0.0' },
        angle: { baseUnit: 'rad', targetUnit: 'degree', displayFormat: '0.0' },
        pressure: { baseUnit: 'Pa', targetUnit: 'mbar', displayFormat: '0' },
        distance: { baseUnit: 'm', targetUnit: 'naut-mile', displayFormat: '0.0' },
      },
    },
    definitions: {
      'm/s': { conversions: { kn: { formula: 'value * 1.94384', symbol: 'kn' } } },
      rad: { conversions: { degree: { formula: 'value * 57.29577951308231', symbol: '°' } } },
      Pa: { conversions: { mbar: { formula: 'value * 0.01', symbol: 'mbar' } } },
      m: { conversions: { 'naut-mile': { formula: 'value * 0.0005399568034557236', symbol: 'nmi' } } },
    },
    defaultCategories: {
      speed: { siUnit: 'm/s', paths: ['navigation.speedOverGround', 'navigation.speedThroughWater', 'environment.wind.speedOverGround'] },
      angle: { siUnit: 'rad', paths: ['navigation.headingTrue', 'environment.wind.directionTrue'] },
      pressure: { siUnit: 'Pa', paths: ['environment.outside.pressure'] },
      distance: { siUnit: 'm', paths: ['navigation.log'] },
    },
  };
}

test('evaluateFormula handles the linear formulas the definitions ship', () => {
  assert.strictEqual(evaluateFormula('value * 1.94384', 3), 5.83152);
  assert.strictEqual(evaluateFormula('value * 0.01', 101325), 1013.25);
  assert.strictEqual(evaluateFormula('value / 3600', 7200), 2);
  assert.strictEqual(evaluateFormula('value', 42), 42);
  assert.strictEqual(evaluateFormula('(value / 0.836)^(2/3)', 5), null, 'non-linear formulas are not evaluated');
  assert.strictEqual(evaluateFormula('formatDurationHMS(value)', 90), null);
  assert.strictEqual(evaluateFormula('garbage', 5), null);
});

test('decimalsFromFormat reads the displayFormat pattern', () => {
  assert.strictEqual(decimalsFromFormat('0.0'), 1);
  assert.strictEqual(decimalsFromFormat('0.00'), 2);
  assert.strictEqual(decimalsFromFormat('0'), 0);
  assert.strictEqual(decimalsFromFormat(undefined), 0);
});

test('categoryForPath matches exact paths and * wildcard segments', () => {
  const prefs = makePrefs();
  assert.strictEqual(categoryForPath(prefs, 'navigation.speedOverGround').category, 'speed');
  assert.strictEqual(categoryForPath(prefs, 'navigation.headingTrue').category, 'angle');
  assert.strictEqual(categoryForPath(prefs, 'environment.wind.speedOverGround').category, 'speed');
  assert.strictEqual(categoryForPath(prefs, 'propulsion.Port.runTime'), null, 'no category for engine runTime');
  assert.strictEqual(categoryForPath(null, 'navigation.log'), null);
});

test('formatTelemetryValue converts per the active preset and its displayFormat', () => {
  const prefs = makePrefs();
  const kn = formatTelemetryValue(prefs, 'navigation.speedOverGround', 4.0138);
  assert.strictEqual(kn.value, '7.8', 'one decimal per displayFormat 0.0');
  assert.strictEqual(kn.unit, 'kn');
  const deg = formatTelemetryValue(prefs, 'navigation.headingTrue', 3.3161);
  assert.strictEqual(deg.value, '190.0');
  assert.strictEqual(deg.unit, '°');
  const mbar = formatTelemetryValue(prefs, 'environment.outside.pressure', 101325);
  assert.strictEqual(mbar.value, '1013', 'zero decimals per displayFormat 0');
  assert.strictEqual(mbar.unit, 'mbar');
  const nmi = formatTelemetryValue(prefs, 'navigation.log', 237796.8);
  assert.strictEqual(nmi.value, '128.4');
  assert.strictEqual(nmi.unit, 'nmi');
});

test('formatTelemetryValue falls back to nautical units without a category', () => {
  const prefs = makePrefs();
  const hours = formatTelemetryValue(prefs, 'propulsion.Port.runTime', 36000);
  assert.strictEqual(hours.value, '10.0', 'engine runTime has no category: nautical fallback');
  assert.strictEqual(hours.unit, 'h');
  const bare = formatTelemetryValue(null, 'navigation.speedOverGround', 4.0138);
  assert.strictEqual(bare.value, '7.8', 'no preferences at all: nautical fallback');
  assert.strictEqual(bare.unit, 'kt');
});

test('applyDisplayUnits converts all shown telemetry from the SI telemetry array', () => {
  const prefs = makePrefs();
  const entry = applyDisplayUnits({
    _telemetry: [
      { path: 'navigation.speedOverGround', value: 4.0138 },
      { path: 'navigation.speedThroughWater', value: 3.8 },
      { path: 'navigation.headingTrue', value: 3.3161 },
      { path: 'environment.wind.speedOverGround', value: 4.0138 },
      { path: 'environment.wind.directionTrue', value: 0.7854 },
      { path: 'environment.outside.pressure', value: 101325 },
      { path: 'navigation.log', value: 237796.8 },
      { path: 'propulsion.Port.runTime', value: 36000 },
    ],
    speed: { sog: 7.800000000000001, stw: 7.4 },
    wind: { speed: 7.800000000000001, direction: 45 },
  }, prefs);
  assert.strictEqual(entry.speed.sog, '7.8', 'the 7.800000000000001kt bug is gone');
  assert.strictEqual(entry.speed.sogUnit, 'kn');
  assert.strictEqual(entry.speed.stwUnit, 'kn');
  assert.strictEqual(entry.heading, '190.0');
  assert.strictEqual(entry.headingUnit, '°');
  assert.strictEqual(entry.wind.speed, '7.8');
  assert.strictEqual(entry.wind.speedUnit, 'kn');
  assert.strictEqual(entry.wind.direction, '45.0');
  assert.strictEqual(entry.wind.directionUnit, '°');
  assert.strictEqual(entry.barometer, '1013');
  assert.strictEqual(entry.barometerUnit, 'mbar');
  assert.strictEqual(entry.log, '128.4');
  assert.strictEqual(entry.logUnit, 'nmi');
  assert.strictEqual(entry.engine.engines.Port.hours, '10.0');
  assert.strictEqual(entry.engine.engines.Port.hoursUnit, 'h');
  assert.strictEqual(entry.engine.hours, '10.0', 'single instance mirrored to the scalar');
  assert.strictEqual(entry.engine.hoursUnit, 'h');
});

test('applyDisplayUnits is idempotent and falls back to nautical units', () => {
  const entry = {
    _telemetry: [
      { path: 'navigation.speedOverGround', value: 4.0138 },
      { path: 'environment.outside.pressure', value: 101325 },
    ],
  };
  const once = applyDisplayUnits(entry, null);
  assert.strictEqual(once.speed.sog, '7.8', 'nautical fallback without preferences');
  assert.strictEqual(once.speed.sogUnit, 'kt');
  assert.strictEqual(once.barometer, '1013.25', 'hPa with two decimals');
  assert.strictEqual(once.barometerUnit, 'hPa');
  const twice = applyDisplayUnits(once, null);
  assert.strictEqual(twice.speed.sog, '7.8', 'reads from _telemetry, so re-running is stable');
});

test('loadUnitPreferences resolves the per-user preset override', async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    if (url.includes('applicationData')) {
      return { ok: true, json: async () => ({ activePreset: 'imperial-us' }) };
    }
    if (url.includes('/presets/imperial-us')) {
      return { ok: true, json: async () => ({ name: 'Imperial US', categories: {} }) };
    }
    return { ok: true, json: async () => ({}) };
  };
  const prefs = await loadUnitPreferences(fetchImpl);
  assert.strictEqual(prefs.presetName, 'imperial-us');
  assert.ok(calls.some((url) => url.includes('/definitions')));
  assert.ok(calls.some((url) => url.includes('/default-categories')));
});

test('loadUnitPreferences falls back to the server-wide active preset', async () => {
  const fetchImpl = async (url) => {
    if (url.includes('applicationData')) {
      return { ok: false, json: async () => ({}) };
    }
    if (url.includes('/unitpreferences/config')) {
      return { ok: true, json: async () => ({ activePreset: 'nautical-metric' }) };
    }
    if (url.includes('/presets/nautical-metric')) {
      return { ok: true, json: async () => ({ name: 'Nautical metric', categories: {} }) };
    }
    return { ok: true, json: async () => ({}) };
  };
  const prefs = await loadUnitPreferences(fetchImpl);
  assert.strictEqual(prefs.presetName, 'nautical-metric');
});

test('loadUnitPreferences resolves null when the server has no unitpreferences API', async () => {
  const fetchImpl = async () => ({ ok: false, json: async () => ({}) });
  const prefs = await loadUnitPreferences(fetchImpl);
  assert.strictEqual(prefs, null, 'nautical fallback rendering applies');
});
