/**
 * Translation between the resources API representation of a log entry
 * (Signal K paths, SI units, `telemetry` array of flattened delta
 * pathvalues — see docs/logentries-resource.md Part 1) and the plugin's
 * historical storage representation (nautical units, historical field
 * names in the YAML day files).
 *
 * The storage shape stays as it always was; everything the resources API
 * speaks is translated here at the boundary. New captures are stored at
 * full precision — no display rounding happens in this layer.
 *
 * Open content model: unknown top-level fields and unknown telemetry
 * paths are preserved verbatim. Known-path pathvalues that carry extra
 * members beyond `path`/`value` (e.g. `$source`, `timestamp`) are parked
 * in the storage `telemetry` array and shadow the field-derived pathvalue
 * on read, so pathvalue-level data survives the round trip.
 *
 * The one non-exact translation is sea state: storage carries the Douglas
 * 0–9 code, the API path `environment.water.seaState` carries the Beaufort
 * scale of the server Weather API. They map through the standard WMO
 * correspondence, approximate in both directions.
 */

const RAD_TO_DEG = 180 / Math.PI;
const DEG_TO_RAD = Math.PI / 180;
const METERS_PER_NM = 1852;
const MS_PER_KT = 463 / 900; // 1 kn = 1852 m/h exactly
const KT_PER_MS = 900 / 463;
const PA_PER_HPA = 100;
const SECONDS_PER_HOUR = 3600;

// WMO correlation between Beaufort force (API) and the Douglas sea state
// code (storage).
const BEAUFORT_TO_DOUGLAS = [0, 1, 2, 3, 3, 4, 5, 5, 6, 7, 8, 8, 9];
const DOUGLAS_TO_BEAUFORT = [0, 1, 2, 3, 5, 6, 8, 9, 10, 12];

// Storage fields that are translated into telemetry pathvalues on read.
// Everything else on a stored entry passes through to the API verbatim.
const STORAGE_ONLY_FIELDS = new Set([
  'position',
  'heading',
  'course',
  'speed',
  'log',
  'waypoint',
  'barometer',
  'wind',
  'observations',
  'engine',
  'vhf',
  'crewNames',
  'skipperName',
  'telemetry',
]);

// Fields of an API payload that are provider control data, never stored.
const CONTROL_FIELDS = ['$source', 'enrich'];

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validPosition(value) {
  return isPlainObject(value)
    && toNumber(value.latitude) !== null
    && toNumber(value.longitude) !== null;
}

function beaufortToDouglas(beaufort) {
  const n = toNumber(beaufort);
  if (n === null || n < 0 || n > 12) {
    return null;
  }
  return BEAUFORT_TO_DOUGLAS[Math.round(n)];
}

function douglasToBeaufort(douglas) {
  const n = toNumber(douglas);
  if (n === null) {
    return null;
  }
  const code = Math.round(n);
  if (code < 0 || code >= DOUGLAS_TO_BEAUFORT.length) {
    return null;
  }
  return DOUGLAS_TO_BEAUFORT[code];
}

/**
 * Convert an SI value to its nautical storage unit, choosing the stored
 * value so the resources API round trip stays stable: the read direction
 * returns the original SI value exactly when one exists (then any re-write
 * of what was read stores an identical value), and otherwise the nearest
 * nautical value that re-converts to itself. The adjustments are at most a
 * few ulps (~1e-13 relative) — far below any display precision.
 */
function snapStorage(si, toNautical, fromNautical) {
  const y0 = toNautical(si);
  const step = y0 === 0 ? Number.MIN_VALUE : Math.abs(y0) * Number.EPSILON;
  let exact = null;
  let stable = null;
  for (let i = 0; i <= 8; i += 1) {
    // Scan y0 and its neighbors: 0, +1, -1, +2, -2, ...
    const k = i === 0 ? 0 : Math.ceil(i / 2) * (i % 2 === 1 ? 1 : -1);
    const y = k === 0 ? y0 : y0 + k * step;
    const back = fromNautical(y);
    if (back === si) {
      if (toNautical(back) === y) {
        return y;
      }
      const err = Math.abs(back - si);
      if (!exact || err < exact.err) {
        exact = { y, err };
      }
    } else if (toNautical(back) === y) {
      const err = Math.abs(back - si);
      if (!stable || err < stable.err) {
        stable = { y, err };
      }
    }
  }
  if (exact) {
    return exact.y;
  }
  if (stable) {
    return stable.y;
  }
  return y0;
}

/**
 * One spec per API path (or path family): how its pathvalue maps into the
 * historical storage fields and back. `toStorage` returns a partial storage
 * update, or null when the value is not representable in storage (the whole
 * pathvalue is then parked verbatim instead).
 */
const PATH_SPECS = [
  {
    path: 'navigation.position',
    toStorage: (value) => (validPosition(value) ? { position: { ...value } } : null),
    fromStorage: (entry) => (validPosition(entry.position)
      ? [{ path: 'navigation.position', value: { ...entry.position } }]
      : []),
  },
  {
    path: 'navigation.headingTrue',
    toStorage: (value) => {
      const rad = toNumber(value);
      const heading = snapStorage(rad, (r) => r * RAD_TO_DEG, (d) => d * DEG_TO_RAD);
      return rad === null ? null : { heading };
    },
    fromStorage: (entry) => {
      const deg = toNumber(entry.heading);
      return deg === null ? [] : [{ path: 'navigation.headingTrue', value: deg * DEG_TO_RAD }];
    },
  },
  {
    path: 'navigation.courseOverGroundTrue',
    toStorage: (value) => {
      const rad = toNumber(value);
      const course = snapStorage(rad, (r) => r * RAD_TO_DEG, (d) => d * DEG_TO_RAD);
      return rad === null ? null : { course };
    },
    fromStorage: (entry) => {
      const deg = toNumber(entry.course);
      return deg === null ? [] : [{ path: 'navigation.courseOverGroundTrue', value: deg * DEG_TO_RAD }];
    },
  },
  {
    path: 'navigation.speedOverGround',
    toStorage: (value) => {
      const ms = toNumber(value);
      const sog = snapStorage(ms, (m) => m * KT_PER_MS, (k) => k * MS_PER_KT);
      return ms === null ? null : { speed: { sog } };
    },
    fromStorage: (entry) => {
      const kt = toNumber(entry.speed && entry.speed.sog);
      return kt === null ? [] : [{ path: 'navigation.speedOverGround', value: kt * MS_PER_KT }];
    },
  },
  {
    path: 'navigation.speedThroughWater',
    toStorage: (value) => {
      const ms = toNumber(value);
      const stw = snapStorage(ms, (m) => m * KT_PER_MS, (k) => k * MS_PER_KT);
      return ms === null ? null : { speed: { stw } };
    },
    fromStorage: (entry) => {
      const kt = toNumber(entry.speed && entry.speed.stw);
      return kt === null ? [] : [{ path: 'navigation.speedThroughWater', value: kt * MS_PER_KT }];
    },
  },
  {
    path: 'navigation.log',
    toStorage: (value) => {
      const meters = toNumber(value);
      const nm = snapStorage(meters, (m) => m / METERS_PER_NM, (v) => v * METERS_PER_NM);
      return meters === null ? null : { log: nm };
    },
    fromStorage: (entry) => {
      const nm = toNumber(entry.log);
      return nm === null ? [] : [{ path: 'navigation.log', value: nm * METERS_PER_NM }];
    },
  },
  {
    path: 'navigation.course.nextPoint',
    toStorage: (value) => {
      if (!isPlainObject(value) || !validPosition(value.position)) {
        return null;
      }
      const waypoint = {
        latitude: value.position.latitude,
        longitude: value.position.longitude,
      };
      if (typeof value.href === 'string') {
        waypoint.href = value.href;
      }
      return { waypoint };
    },
    fromStorage: (entry) => {
      if (!validPosition(entry.waypoint)) {
        return [];
      }
      const value = {
        position: {
          latitude: entry.waypoint.latitude,
          longitude: entry.waypoint.longitude,
        },
      };
      if (typeof entry.waypoint.href === 'string') {
        value.href = entry.waypoint.href;
      }
      return [{ path: 'navigation.course.nextPoint', value }];
    },
  },
  {
    path: 'environment.outside.pressure',
    toStorage: (value) => {
      const pa = toNumber(value);
      const barometer = snapStorage(pa, (p) => p / PA_PER_HPA, (h) => h * PA_PER_HPA);
      return pa === null ? null : { barometer };
    },
    fromStorage: (entry) => {
      const hpa = toNumber(entry.barometer);
      return hpa === null ? [] : [{ path: 'environment.outside.pressure', value: hpa * PA_PER_HPA }];
    },
  },
  {
    path: 'environment.wind.speedOverGround',
    toStorage: (value) => {
      const ms = toNumber(value);
      const speed = snapStorage(ms, (m) => m * KT_PER_MS, (k) => k * MS_PER_KT);
      return ms === null ? null : { wind: { speed } };
    },
    fromStorage: (entry) => {
      const kt = toNumber(entry.wind && entry.wind.speed);
      return kt === null ? [] : [{ path: 'environment.wind.speedOverGround', value: kt * MS_PER_KT }];
    },
  },
  {
    path: 'environment.wind.directionTrue',
    toStorage: (value) => {
      const rad = toNumber(value);
      const direction = snapStorage(rad, (r) => r * RAD_TO_DEG, (d) => d * DEG_TO_RAD);
      return rad === null ? null : { wind: { direction } };
    },
    fromStorage: (entry) => {
      const deg = toNumber(entry.wind && entry.wind.direction);
      return deg === null ? [] : [{ path: 'environment.wind.directionTrue', value: deg * DEG_TO_RAD }];
    },
  },
  {
    path: 'environment.water.seaState',
    toStorage: (value) => {
      const douglas = beaufortToDouglas(value);
      return douglas === null ? null : { observations: { seaState: douglas } };
    },
    fromStorage: (entry) => {
      const beaufort = douglasToBeaufort(entry.observations && entry.observations.seaState);
      return beaufort === null ? [] : [{ path: 'environment.water.seaState', value: beaufort }];
    },
  },
  {
    path: 'environment.outside.cloudCover',
    toStorage: (value) => {
      const ratio = toNumber(value);
      if (ratio === null || ratio < 0 || ratio > 1) {
        return null;
      }
      return { observations: { cloudCoverage: ratio * 8 } };
    },
    fromStorage: (entry) => {
      const oktas = toNumber(entry.observations && entry.observations.cloudCoverage);
      return oktas === null ? [] : [{ path: 'environment.outside.cloudCover', value: oktas / 8 }];
    },
  },
  {
    path: 'environment.outside.visibility',
    toStorage: (value) => {
      const code = toNumber(value);
      return code === null ? null : { observations: { visibility: code } };
    },
    fromStorage: (entry) => {
      const code = toNumber(entry.observations && entry.observations.visibility);
      return code === null ? [] : [{ path: 'environment.outside.visibility', value: code }];
    },
  },
  {
    path: 'communication.vhf.channel',
    toStorage: (value) => (typeof value === 'string' && value.length > 0 ? { vhf: value } : null),
    fromStorage: (entry) => (typeof entry.vhf === 'string' && entry.vhf.length > 0
      ? [{ path: 'communication.vhf.channel', value: entry.vhf }]
      : []),
  },
  {
    path: 'communication.crewNames',
    toStorage: (value) => (Array.isArray(value) ? { crewNames: [...value] } : null),
    fromStorage: (entry) => (Array.isArray(entry.crewNames)
      ? [{ path: 'communication.crewNames', value: [...entry.crewNames] }]
      : []),
  },
  {
    path: 'communication.skipperName',
    toStorage: (value) => (typeof value === 'string' && value.length > 0 ? { skipperName: value } : null),
    fromStorage: (entry) => (typeof entry.skipperName === 'string' && entry.skipperName.length > 0
      ? [{ path: 'communication.skipperName', value: entry.skipperName }]
      : []),
  },
];

const PROPULSION_PATTERN = /^propulsion\.([^.]+)\.runTime$/;

function findSpec(path) {
  return PATH_SPECS.find((spec) => spec.path === path) || null;
}

function hasExtraMembers(pathvalue) {
  return Object.keys(pathvalue).some((key) => key !== 'path' && key !== 'value');
}

/**
 * Translate an API entry into the historical storage shape. Returns the
 * storage entry; throws on a malformed telemetry array.
 */
function apiToStorage(apiEntry) {
  const storage = {};
  Object.keys(apiEntry).forEach((key) => {
    if (key === 'telemetry') {
      return;
    }
    if (CONTROL_FIELDS.includes(key)) {
      // Control data, never persisted
      return;
    }
    if (key === 'engine') {
      // The legacy single-engine scalar is dropped on write, not
      // interpreted and not preserved (targeted exception to open-content
      // preservation; reads never emit it either).
      return;
    }
    storage[key] = apiEntry[key];
  });

  const parked = [];
  const engines = {};
  let hasEngines = false;

  (apiEntry.telemetry || []).forEach((pathvalue) => {
    if (!isPlainObject(pathvalue) || typeof pathvalue.path !== 'string') {
      throw new Error('telemetry entries must be pathvalues with a path');
    }
    const { path, value } = pathvalue;
    let mapped = false;

    const propulsionMatch = path.match(PROPULSION_PATTERN);
    if (propulsionMatch) {
      const seconds = toNumber(value);
      if (seconds !== null) {
        engines[propulsionMatch[1]] = {
          hours: snapStorage(seconds, (s) => s / SECONDS_PER_HOUR, (h) => h * SECONDS_PER_HOUR),
        };
        hasEngines = true;
        mapped = true;
      }
    } else {
      const spec = findSpec(path);
      if (spec) {
        const update = spec.toStorage(value);
        if (update) {
          Object.keys(update).forEach((field) => {
            if (field === 'speed' || field === 'wind' || field === 'observations') {
              storage[field] = { ...storage[field], ...update[field] };
            } else {
              storage[field] = update[field];
            }
          });
          mapped = true;
        }
      }
    }

    // Unknown paths and known paths carrying extra pathvalue members are
    // parked verbatim so they survive the storage round trip.
    if (!mapped || hasExtraMembers(pathvalue)) {
      parked.push(pathvalue);
    }
  });

  if (hasEngines) {
    storage.engine = { engines };
  }
  if (parked.length > 0) {
    storage.telemetry = parked;
  }
  return storage;
}

/**
 * Translate a stored entry back into the API representation. `datetime` is
 * normalized to an ISO string. Field-derived pathvalues are emitted for
 * known storage fields, except where a parked pathvalue for the same path
 * shadows them.
 */
function storageToApi(entry) {
  const api = {};
  Object.keys(entry).forEach((key) => {
    if (STORAGE_ONLY_FIELDS.has(key)) {
      return;
    }
    if (key === 'datetime' && entry.datetime instanceof Date) {
      api.datetime = entry.datetime.toISOString();
      return;
    }
    api[key] = entry[key];
  });

  const parked = Array.isArray(entry.telemetry) ? entry.telemetry : [];
  const parkedPaths = new Set(parked.map((pv) => pv.path));

  const pathvalues = [];
  PATH_SPECS.forEach((spec) => {
    spec.fromStorage(entry).forEach((pv) => {
      if (!parkedPaths.has(pv.path)) {
        pathvalues.push(pv);
      }
    });
  });
  // Engine data: one pathvalue per instance from the engines map. The
  // legacy single-engine scalar is served as propulsion.default.runTime —
  // and never as an engine field in the API.
  if (entry.engine) {
    if (entry.engine.engines && typeof entry.engine.engines === 'object') {
      Object.keys(entry.engine.engines).forEach((instance) => {
        const engineEntry = entry.engine.engines[instance];
        const hours = toNumber(engineEntry && engineEntry.hours);
        if (hours !== null && !parkedPaths.has(`propulsion.${instance}.runTime`)) {
          pathvalues.push({
            path: `propulsion.${instance}.runTime`,
            value: hours * SECONDS_PER_HOUR,
          });
        }
      });
    } else {
      const hours = toNumber(entry.engine.hours);
      if (hours !== null && !parkedPaths.has('propulsion.default.runTime')) {
        pathvalues.push({
          path: 'propulsion.default.runTime',
          value: hours * SECONDS_PER_HOUR,
        });
      }
    }
  }
  parked.forEach((pv) => pathvalues.push(pv));

  if (pathvalues.length > 0) {
    api.telemetry = pathvalues;
  }
  return api;
}

module.exports = {
  RAD_TO_DEG,
  DEG_TO_RAD,
  METERS_PER_NM,
  MS_PER_KT,
  KT_PER_MS,
  PA_PER_HPA,
  SECONDS_PER_HOUR,
  BEAUFORT_TO_DOUGLAS,
  DOUGLAS_TO_BEAUFORT,
  apiToStorage,
  storageToApi,
  beaufortToDouglas,
  douglasToBeaufort,
  validPosition,
  snapStorage,
};
