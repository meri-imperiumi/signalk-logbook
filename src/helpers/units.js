// Display formatting through the server's unit preferences. The admin UI
// lets each user pick a unit preset (nautical-metric, imperial-us, …) with
// per-category target units and display formats; the same rules are served
// over REST (/signalk/v1/unitpreferences/*) and are what the logbook uses
// to render telemetry — replacing hardcoded nautical display.
//
// Resolution mirrors the admin UI: per-user preset override, then the
// server-wide active preset, then nautical-metric. On servers without the
// unitpreferences API (or any fetch failure) rendering falls back to the
// nautical display the plugin has always used.
//
// Only display-only fields are converted here. The values a user can edit
// (position, observation codes, VHF channel) are unit-less or code scales
// and stay untouched, so display conversion never feeds back into writes.

const {
  KT_PER_MS,
  RAD_TO_DEG,
  METERS_PER_NM,
  PA_PER_HPA,
  SECONDS_PER_HOUR,
} = require('../../plugin/telemetry');

const DEFAULT_PRESET = 'nautical-metric';

// Fields the UI adds for rendering that are never persisted
const DISPLAY_ONLY_FIELDS = [
  'speed', 'wind', 'barometer', 'log', 'heading', 'course', 'engine',
  'sogUnit', 'stwUnit', 'headingUnit', 'courseUnit',
  'speedUnit', 'directionUnit', 'barometerUnit', 'logUnit',
];

// Nautical fallbacks used when unit preferences are unavailable or a path
// has no category — the units and precisions the plugin historically
// captured at. Each converts from the SI telemetry value.
const FALLBACKS = {
  speedOverGround: { unit: 'kt', decimals: 1, convert: (v) => v * KT_PER_MS },
  speedThroughWater: { unit: 'kt', decimals: 1, convert: (v) => v * KT_PER_MS },
  headingTrue: { unit: '°', decimals: 0, convert: (v) => v * RAD_TO_DEG },
  courseOverGroundTrue: { unit: '°', decimals: 0, convert: (v) => v * RAD_TO_DEG },
  windDirectionTrue: { unit: '°', decimals: 0, convert: (v) => v * RAD_TO_DEG },
  log: { unit: 'NM', decimals: 1, convert: (v) => v / METERS_PER_NM },
  pressure: { unit: 'hPa', decimals: 2, convert: (v) => v / PA_PER_HPA },
  runTime: { unit: 'h', decimals: 1, convert: (v) => v / SECONDS_PER_HOUR },
};

function fallbackFor(path) {
  const tail = path.split('.').pop();
  if (FALLBACKS[tail]) {
    return FALLBACKS[tail];
  }
  if (tail === 'directionTrue') {
    return FALLBACKS.windDirectionTrue;
  }
  return null;
}

function credentialsFetch(url) {
  return fetch(url, { credentials: 'include' });
}

// Safe evaluation of the unit conversion formulas. The bundled definitions
// are linear (`value * 1.94384`, `value / 3600`); anything else — custom
// mathjs formulas, duration formatters — falls back rather than eval'ing.
function evaluateFormula(formula, value) {
  if (typeof formula !== 'string') {
    return null;
  }
  const multiply = formula.match(/^value\s*\*\s*(-?[\d.eE+-]+)$/);
  if (multiply) {
    const factor = Number(multiply[1]);
    return Number.isFinite(factor) ? value * factor : null;
  }
  const divide = formula.match(/^value\s*\/\s*([\d.eE+-]+)$/);
  if (divide) {
    const divisor = Number(divide[1]);
    return divisor > 0 ? value / divisor : null;
  }
  if (formula.trim() === 'value') {
    return value;
  }
  return null;
}

// Decimals implied by a displayFormat pattern: "0.0" → 1, "0" → 0
function decimalsFromFormat(displayFormat) {
  if (typeof displayFormat !== 'string' || !displayFormat.includes('.')) {
    return 0;
  }
  return displayFormat.split('.')[1].length;
}

// Match a telemetry path against the default-categories path list:
// exact paths, `*` wildcard segments, or a listed path as a prefix.
function categoryForPath(prefs, path) {
  if (!prefs || !prefs.defaultCategories) {
    return null;
  }
  let best = null;
  Object.keys(prefs.defaultCategories).forEach((category) => {
    prefs.defaultCategories[category].paths.forEach((pattern) => {
      let matches = path === pattern;
      if (!matches && pattern.includes('*')) {
        const regex = new RegExp(`^${pattern.split('.').map((segment) => (segment === '*' ? '[^.]+' : segment)).join('\\.')}$`);
        matches = regex.test(path);
      }
      if (!matches && path.startsWith(`${pattern}.`)) {
        matches = true;
      }
      if (matches && (!best || pattern.length > best.pattern.length)) {
        best = { category, pattern, siUnit: prefs.defaultCategories[category].siUnit };
      }
    });
  });
  return best;
}

/**
 * Format one SI telemetry value for display. Returns
 * { value: <string>, unit: <string> } — value already rounded per the
 * preset's displayFormat (or the nautical fallback precision).
 */
function formatTelemetryValue(prefs, path, siValue) {
  const numeric = Number(siValue);
  if (!Number.isFinite(numeric)) {
    return { value: String(siValue), unit: '' };
  }
  if (prefs && prefs.activePreset && prefs.definitions) {
    const match = categoryForPath(prefs, path);
    if (match) {
      const cat = prefs.activePreset.categories[match.category];
      const conversion = match.siUnit
        && prefs.definitions[match.siUnit]
        && prefs.definitions[match.siUnit].conversions[cat.targetUnit];
      const converted = evaluateFormula(conversion && conversion.formula, numeric);
      if (conversion && converted !== null) {
        const unit = conversion.symbol || cat.targetUnit;
        return {
          value: converted.toFixed(decimalsFromFormat(cat.displayFormat)),
          unit,
        };
      }
    }
  }
  const fallback = fallbackFor(path);
  if (fallback) {
    return {
      value: fallback.convert(numeric).toFixed(fallback.decimals),
      unit: fallback.unit,
    };
  }
  return { value: String(siValue), unit: '' };
}

/**
 * Resolve the active unit preferences server-side. Mirrors the admin UI:
 * per-user override, then the server-wide active preset, then
 * nautical-metric. Resolves null when the server has no unitpreferences
 * API — callers then get the nautical fallback rendering.
 */
async function loadUnitPreferences(fetchImpl) {
  const doFetch = fetchImpl || credentialsFetch;
  const getJson = async (url) => {
    const res = await doFetch(url);
    if (!res.ok) {
      throw new Error(`${url}: ${res.status}`);
    }
    return res.json();
  };

  let presetName;
  try {
    const userConfig = await getJson('/signalk/v1/applicationData/user/unitpreferences/1.0.0');
    if (userConfig && userConfig.activePreset) {
      presetName = userConfig.activePreset;
    }
  } catch (err) {
    presetName = undefined;
  }
  if (!presetName) {
    try {
      const config = await getJson('/signalk/v1/unitpreferences/config');
      presetName = (config && config.activePreset) || DEFAULT_PRESET;
    } catch (err) {
      // No unitpreferences API on this server
      return null;
    }
  }

  try {
    const [preset, definitions, defaultCategories] = await Promise.all([
      getJson(`/signalk/v1/unitpreferences/presets/${encodeURIComponent(presetName)}`),
      getJson('/signalk/v1/unitpreferences/definitions'),
      getJson('/signalk/v1/unitpreferences/default-categories').then((data) => data.categories),
    ]);
    return {
      presetName,
      activePreset: preset,
      definitions,
      defaultCategories: defaultCategories || {},
    };
  } catch (err) {
    return null;
  }
}

function firstTelemetryValue(entry, path) {
  const pv = (entry._telemetry || []).find((item) => item && item.path === path);
  return pv ? pv.value : undefined;
}

/**
 * Rewrite the display-only fields of a UI entry from its original SI
 * telemetry (`_telemetry`), converted and formatted per the user's unit
 * preferences. With `prefs` null (no unitpreferences API) the nautical
 * fallback rendering applies. Idempotent: reads only from `_telemetry`,
 * so it can run again any time preferences resolve or entries refetch.
 * Returns a new entry; the input is left untouched.
 */
function applyDisplayUnits(entry, prefs) {
  const format = (path, value) => formatTelemetryValue(prefs, path, value);
  const display = {};

  const fromTelemetry = (path, key, unitKey) => {
    const value = firstTelemetryValue(entry, path);
    if (value !== undefined) {
      const formatted = format(path, value);
      display[key] = formatted.value;
      if (unitKey) {
        display[unitKey] = formatted.unit;
      }
    }
  };

  fromTelemetry('navigation.speedOverGround', 'sog', 'sogUnit');
  fromTelemetry('navigation.speedThroughWater', 'stw', 'stwUnit');
  fromTelemetry('navigation.headingTrue', 'heading', 'headingUnit');
  fromTelemetry('navigation.courseOverGroundTrue', 'course', 'courseUnit');
  fromTelemetry('environment.wind.speedOverGround', 'speed', 'speedUnit');
  fromTelemetry('environment.wind.directionTrue', 'direction', 'directionUnit');
  fromTelemetry('environment.outside.pressure', 'barometer', 'barometerUnit');
  fromTelemetry('navigation.log', 'log', 'logUnit');

  // Nested display shapes keep the components' existing access patterns:
  // entry.speed.sog, entry.wind.speed — now alongside their unit fields
  const speed = { ...(entry.speed || {}) };
  const wind = { ...(entry.wind || {}) };
  ['sog', 'sogUnit', 'stw', 'stwUnit'].forEach((key) => {
    if (display[key] !== undefined) {
      speed[key] = display[key];
      delete display[key];
    }
  });
  ['speed', 'speedUnit', 'direction', 'directionUnit'].forEach((key) => {
    if (display[key] !== undefined) {
      wind[key] = display[key];
      delete display[key];
    }
  });
  if (Object.keys(speed).length > 0) {
    display.speed = speed;
  }
  if (Object.keys(wind).length > 0) {
    display.wind = wind;
  }

  const engine = { engines: {} };
  let hasEngines = false;
  (entry._telemetry || []).forEach((pv) => {
    if (pv && pv.path && pv.path.match(/^propulsion\.([^.]+)\.runTime$/)) {
      const instance = pv.path.split('.')[1];
      const formatted = format(pv.path, pv.value);
      engine.engines[instance] = { hours: formatted.value, hoursUnit: formatted.unit };
      hasEngines = true;
    }
  });
  if (hasEngines) {
    const instances = Object.keys(engine.engines);
    if (instances.length === 1) {
      engine.hours = engine.engines[instances[0]].hours;
      engine.hoursUnit = engine.engines[instances[0]].hoursUnit;
    }
    display.engine = engine;
  }

  return {
    ...entry,
    ...display,
  };
}

module.exports = {
  DEFAULT_PRESET,
  DISPLAY_ONLY_FIELDS,
  applyDisplayUnits,
  categoryForPath,
  decimalsFromFormat,
  evaluateFormula,
  fallbackFor,
  formatTelemetryValue,
  loadUnitPreferences,
};
