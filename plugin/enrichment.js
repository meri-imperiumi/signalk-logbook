/**
 * Tiered enrichment for log entries written through the resources API
 * (docs/logentries-resource.md, Part 2): fills only the telemetry paths
 * the payload omits — a path already present is never added a second
 * time, explicit pathvalues always win.
 *
 * Both tiers source Signal K-native SI values and emit delta pathvalues
 * directly, so no unit conversion or reshaping is needed on the API side;
 * conversion to nautical storage units happens once, at the storage
 * write (plugin/telemetry.js).
 *
 * - Buffer tier: entry datetime is now or up to 15 minutes in the past —
 *   values come from the live state circular buffer, exactly like the
 *   v1 `POST /logs` with `ago`.
 * - History tier: any older backdated datetime — one getValues call for
 *   the captured paths over the widest tolerance window around the entry
 *   datetime; per path, the recorded value nearest the entry datetime is
 *   kept only when it falls within that path's tolerance. The lookup is
 *   read-only, runs outside the per-date write queue under a bounded
 *   timeout, and on timeout or error the entry stores with whatever is
 *   already filled.
 */

const BUFFER_TIER_MINUTES = 15;
const WIDEST_TOLERANCE_MS = 10 * 60 * 1000;
const HISTORY_TIMEOUT_MS = 2000;

// Per-path enrichment tolerances (ms). Fast-changing paths get a tight
// window — during a maneuver, a minute-old heading describes a different
// boat — slow-changing ones tolerate sparse sensors and intermittent
// sources.
const FAST_TOLERANCE_MS = 5 * 1000;
const MEDIUM_TOLERANCE_MS = 60 * 1000;
const SLOW_TOLERANCE_MS = 10 * 60 * 1000;

const PATH_TOLERANCES = {
  'navigation.headingTrue': FAST_TOLERANCE_MS,
  'navigation.courseOverGroundTrue': FAST_TOLERANCE_MS,
  'navigation.position': MEDIUM_TOLERANCE_MS,
  'navigation.speedOverGround': MEDIUM_TOLERANCE_MS,
  'navigation.speedThroughWater': MEDIUM_TOLERANCE_MS,
  'navigation.course.nextPoint': MEDIUM_TOLERANCE_MS,
  'environment.wind.speedOverGround': MEDIUM_TOLERANCE_MS,
  'environment.wind.directionTrue': MEDIUM_TOLERANCE_MS,
  'environment.outside.pressure': SLOW_TOLERANCE_MS,
  'navigation.log': SLOW_TOLERANCE_MS,
  'environment.water.seaState': SLOW_TOLERANCE_MS,
  'environment.outside.cloudCover': SLOW_TOLERANCE_MS,
  'environment.outside.visibility': SLOW_TOLERANCE_MS,
  'communication.vhf.channel': SLOW_TOLERANCE_MS,
  'communication.crewNames': SLOW_TOLERANCE_MS,
  'communication.skipperName': SLOW_TOLERANCE_MS,
};

// The recommended core set of telemetry paths enrichment tries to fill.
// Engine instances are added dynamically from the live state.
const CAPTURE_PATHS = Object.keys(PATH_TOLERANCES);

function hasPath(telemetry, path) {
  return telemetry.some((pv) => pv && pv.path === path);
}

function pushPathvalue(telemetry, path, value) {
  if (value === undefined || value === null) {
    return;
  }
  telemetry.push({ path, value });
}

/**
 * Read one capture path from a buffered live-state snapshot (path → SI
 * value). Sea state accepts the legacy `environment.water.swell.state`
 * (Douglas) source earlier versions of this plugin read; cloud cover
 * falls back to the legacy oktas path.
 */
function readSnapshotPath(snapshot, path) {
  if (path === 'environment.water.seaState') {
    if (snapshot['environment.water.seaState'] !== undefined) {
      return snapshot['environment.water.seaState'];
    }
    const douglas = snapshot['environment.water.swell.state'];
    if (douglas === undefined || douglas === null) {
      return undefined;
    }
    const code = Math.round(Number(douglas));
    // Douglas 0–9 to Beaufort via the standard WMO correspondence
    const beaufort = [0, 1, 2, 3, 5, 6, 8, 9, 10, 12][code];
    return code >= 0 && code <= 9 ? beaufort : undefined;
  }
  if (path === 'environment.outside.cloudCover') {
    if (snapshot['environment.outside.cloudCover'] !== undefined) {
      return snapshot['environment.outside.cloudCover'];
    }
    const oktas = snapshot['environment.outside.cloudCoverage'];
    return oktas === undefined || oktas === null ? undefined : Number(oktas) / 8;
  }
  return snapshot[path];
}

function positionFromSnapshot(snapshot) {
  const position = snapshot['navigation.position'];
  if (!position || typeof position !== 'object') {
    return undefined;
  }
  const value = {
    latitude: position.latitude,
    longitude: position.longitude,
  };
  if (position.altitude !== undefined) {
    value.altitude = position.altitude;
  }
  if (snapshot['navigation.gnss.type']) {
    value.source = snapshot['navigation.gnss.type'];
  }
  return value;
}

function withTelemetry(entry, telemetry) {
  return telemetry.length > 0 ? { ...entry, telemetry } : entry;
}

/**
 * Buffer tier: fill missing capture paths from a live-state snapshot.
 * Returns the entry with any additions.
 */
function fillFromSnapshot(entry, snapshot) {
  if (!snapshot || typeof snapshot !== 'object') {
    return entry;
  }
  const telemetry = entry.telemetry || [];
  CAPTURE_PATHS.forEach((path) => {
    if (hasPath(telemetry, path)) {
      return;
    }
    if (path === 'navigation.position') {
      const value = positionFromSnapshot(snapshot);
      if (value) {
        telemetry.push({ path, value });
      }
      return;
    }
    pushPathvalue(telemetry, path, readSnapshotPath(snapshot, path));
  });
  // One pathvalue per engine instance, like the live paths
  Object.keys(snapshot).forEach((key) => {
    if (key.match(/^propulsion\.[^.]+\.runTime$/) && !hasPath(telemetry, key)) {
      pushPathvalue(telemetry, key, snapshot[key]);
    }
  });
  return withTelemetry(entry, telemetry);
}

/**
 * Normalize a History API getValues response into candidates per path:
 * an array of { timestamp (ms), value, $source? }. Supports the modern
 * ValuesResponse shape ({values: pathSpecs, data: rows}) and a legacy
 * delta-list shape.
 */
function candidatesFromHistoryResponse(response) {
  const candidates = [];
  if (Array.isArray(response)) {
    response.forEach((delta) => {
      if (!delta || !Array.isArray(delta.values)) {
        return;
      }
      const t = Date.parse(delta.timestamp || '');
      delta.values.forEach((pv) => {
        if (pv && typeof pv.path === 'string') {
          candidates.push({
            path: pv.path,
            value: pv.value,
            $source: pv.$source,
            timestamp: Number.isNaN(t) ? null : t,
          });
        }
      });
    });
    return candidates;
  }
  if (!response || !Array.isArray(response.values) || !Array.isArray(response.data)) {
    return candidates;
  }
  response.data.forEach((row) => {
    if (!Array.isArray(row) || row.length < 1) {
      return;
    }
    const t = Date.parse(row[0]);
    response.values.forEach((spec, i) => {
      const value = row[i + 1];
      if (spec && typeof spec.path === 'string' && value !== null && value !== undefined) {
        candidates.push({
          path: spec.path,
          value,
          $source: spec.$source,
          timestamp: Number.isNaN(t) ? null : t,
        });
      }
    });
  });
  return candidates;
}

function toleranceFor(path) {
  if (PATH_TOLERANCES[path] !== undefined) {
    return PATH_TOLERANCES[path];
  }
  if (path.match(/^propulsion\.[^.]+\.runTime$/)) {
    return SLOW_TOLERANCE_MS;
  }
  return null;
}

/**
 * History tier: one getValues call over the widest tolerance window, then
 * per-path nearest-within-tolerance fills. Never throws: on any failure
 * the entry keeps whatever is already filled. Returns the entry with any
 * additions.
 */
async function fillFromHistory(entry, historyApi, atMs, enginePaths) {
  const telemetry = entry.telemetry || [];
  const missing = CAPTURE_PATHS.filter((path) => !hasPath(telemetry, path));
  const engineLookups = (enginePaths || []).filter((path) => !hasPath(telemetry, path));
  const lookupPaths = [...missing, ...engineLookups];
  if (lookupPaths.length === 0) {
    return entry;
  }

  const pathSpecs = [];
  lookupPaths.forEach((path) => {
    // Both ends of the window: for each path the value nearest the entry
    // datetime is chosen among first/last candidates within tolerance.
    pathSpecs.push({ path, aggregate: 'first', parameter: [] });
    pathSpecs.push({ path, aggregate: 'last', parameter: [] });
  });
  const response = await historyApi.getValues({
    from: new Date(atMs - WIDEST_TOLERANCE_MS).toISOString(),
    to: new Date(atMs + WIDEST_TOLERANCE_MS).toISOString(),
    pathSpecs,
  });
  const candidates = candidatesFromHistoryResponse(response);
  lookupPaths.forEach((path) => {
    const tolerance = toleranceFor(path);
    if (tolerance === null) {
      return;
    }
    let best = null;
    candidates.forEach((candidate) => {
      if (candidate.path !== path || candidate.timestamp === null) {
        return;
      }
      const distance = Math.abs(candidate.timestamp - atMs);
      if (distance > tolerance) {
        return;
      }
      if (!best || distance < best.distance) {
        best = { ...candidate, distance };
      }
    });
    if (best) {
      const pv = { path, value: best.value };
      if (best.$source) {
        pv.$source = best.$source;
      }
      telemetry.push(pv);
    }
  });
  return withTelemetry(entry, telemetry);
}

/**
 * Enrich an API entry in place before storage. Returns a promise resolving
 * to the entry. `enrich: false` skips all lookups (the bulk path for
 * importers that carry complete data).
 */
async function enrichEntry(entry, {
  now, snapshot, enginePaths, historyApi, historyTimeoutMs,
}) {
  if (entry.enrich === false) {
    return entry;
  }
  const atMs = Date.parse(entry.datetime);
  if (Number.isNaN(atMs)) {
    return entry;
  }

  if (snapshot) {
    return fillFromSnapshot(entry, snapshot);
  }
  if (!historyApi || atMs > now) {
    return entry;
  }
  try {
    const lookup = fillFromHistory(entry, historyApi, atMs, enginePaths || []);
    // The timer is deliberately NOT unref'd: an unref'd timeout is the only
    // pending handle while a history lookup hangs, and the event loop can
    // then drain before it fires — the write would never resolve. A hung
    // provider instead leaves a ref'd timer alive for at most
    // historyTimeoutMs, which is bounded and harmless.
    const timeout = new Promise((resolve) => {
      setTimeout(() => resolve(), historyTimeoutMs || HISTORY_TIMEOUT_MS);
    });
    return (await Promise.race([lookup, timeout])) || entry;
  } catch (err) {
    // Slow, hanging or unavailable history provider delays only its own
    // entry and never fails the write: store un-enriched.
    return entry;
  }
}

module.exports = {
  BUFFER_TIER_MINUTES,
  CAPTURE_PATHS,
  PATH_TOLERANCES,
  WIDEST_TOLERANCE_MS,
  HISTORY_TIMEOUT_MS,
  enrichEntry,
  fillFromSnapshot,
  fillFromHistory,
  candidatesFromHistoryResponse,
  readSnapshotPath,
};
