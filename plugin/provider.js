/**
 * The Signal K v2 `logentries` resource provider (docs/logentries-resource.md,
 * Part 1). Maps the ResourceProviderMethods onto the Log storage:
 *
 * - Resource ids are UUIDs; `setResource` is a create-or-replace upsert on
 *   the id. Fields the payload omits are preserved on replace and defaulted
 *   on create: `datetime` (now), `origin` ('agent'), `author` (''), and
 *   `telemetry` (enrichment fills the paths it captures). A supplied
 *   `telemetry` array — even empty — is taken as sent on either, so a
 *   replace can remove paths without enrichment refilling them.
 * - Listings must carry a window (`date`, `from`/`to`, or `limit`) so every
 *   response is complete by construction — no silent truncation.
 * - Reads add the entry-level `$source` (provider plugin id); entry-level
 *   `$source` and the `enrich` control field are stripped on write.
 * - `timestamp` is set on every write (create and replace alike).
 * - Entries created through this API default to `origin: 'agent'`; a
 *   replace preserves the stored origin.
 */
const { apiToStorage, storageToApi, validPosition } = require('./telemetry');
const { enrichEntry, BUFFER_TIER_MINUTES } = require('./enrichment');

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^\d{4}-([0]\d|1[0-2])-([0-2]\d|3[01])$/;

function fail(message) {
  const err = new Error(message);
  err.code = 'EINVAL';
  throw err;
}

function notFound(id) {
  const err = new Error(`Entry ${id} not found`);
  err.code = 'ENOENT';
  return err;
}

function isUuid(id) {
  return typeof id === 'string' && id.match(UUID_PATTERN) !== null;
}

function parseBbox(raw) {
  const parts = String(raw).split(',').map((n) => Number(n));
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
    fail('bbox must be lon,lat,lon,lat');
  }
  return {
    lonMin: Math.min(parts[0], parts[2]),
    lonMax: Math.max(parts[0], parts[2]),
    latMin: Math.min(parts[1], parts[3]),
    latMax: Math.max(parts[1], parts[3]),
  };
}

function positionInBbox(entry, bbox) {
  // Storage shape: the mapped position field, plus parked position
  // pathvalues (entries written with extra pathvalue members).
  const candidates = [];
  if (validPosition(entry.position)) {
    candidates.push(entry.position);
  }
  (entry.telemetry || []).forEach((pv) => {
    if (pv && pv.path === 'navigation.position' && validPosition(pv.value)) {
      candidates.push(pv.value);
    }
  });
  if (candidates.length === 0) {
    return false;
  }
  return candidates.some((value) => value.latitude >= bbox.latMin
    && value.latitude <= bbox.latMax
    && value.longitude >= bbox.lonMin
    && value.longitude <= bbox.lonMax);
}

function datesInRange(fromIso, toIso) {
  const dates = [];
  const from = new Date(fromIso);
  const to = new Date(toIso);
  const cursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  const end = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate()));
  while (cursor.getTime() <= end.getTime()) {
    dates.push(cursor.toISOString().substr(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

function entryMatches(entry, query) {
  if (query.category !== undefined && entry.category !== query.category) {
    return false;
  }
  if (query.origin !== undefined && entry.origin !== query.origin) {
    return false;
  }
  if (query.author !== undefined && entry.author !== query.author) {
    return false;
  }
  if (query.bbox !== undefined && !positionInBbox(entry, query.bbox)) {
    return false;
  }
  return true;
}

/**
 * Create the provider methods. Options:
 * - app: the Signal K app (used for getHistoryApi)
 * - log: the Log storage instance (migrated)
 * - bufferLookup: (atMs) => live-state snapshot for the buffer tier
 * - enginePaths: () => array of propulsion.<instance>.runTime paths known live
 * - providerId: the entry-level $source stamped onto reads
 */
function createLogentriesProvider(options) {
  const {
    app, log, bufferLookup, enginePaths, providerId, historyTimeoutMs,
  } = options;

  function withSource(apiEntry) {
    return {
      ...apiEntry,
      $source: providerId,
    };
  }

  async function listDates(query) {
    let dates;
    if (query.date) {
      if (!DATE_PATTERN.test(query.date)) {
        fail('date must be YYYY-MM-DD');
      }
      dates = [query.date];
    } else if (query.from || query.to) {
      const fromIso = query.from || new Date(0).toISOString();
      const toIso = query.to || new Date().toISOString();
      const from = new Date(fromIso);
      const to = new Date(toIso);
      if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
        fail('from and to must be RFC 3339 datetimes');
      }
      if (from > to) {
        fail('from must not be after to');
      }
      dates = datesInRange(from.toISOString(), to.toISOString());
    } else {
      dates = await log.listDates();
      dates.sort();
    }
    return dates;
  }

  async function collectEntries(dates) {
    const readDate = (date) => log.getDate(date)
      // Day file vanished or is unreadable: skip it, listings never fail
      // for a single bad day.
      .catch(() => []);
    const collected = await dates.reduce(
      (prev, date) => prev.then((acc) => readDate(date).then((dateData) => acc.concat(dateData))),
      Promise.resolve([]),
    );
    return collected;
  }

  async function buildCalendar(dates) {
    const readCount = (date) => log.getDate(date)
      .then((dateData) => [date, dateData.length])
      .catch(() => null);
    const counted = await dates.reduce(
      (prev, date) => prev.then((acc) => readCount(date)
        .then((pair) => (pair ? acc.concat([pair]) : acc))),
      Promise.resolve([]),
    );
    const calendar = {};
    counted.forEach(([date, count]) => {
      if (count > 0) {
        calendar[date] = { count };
      }
    });
    return calendar;
  }

  return {
    async listResources(query) {
      const q = query || {};
      const hasWindow = q.date || q.from || q.to || q.limit !== undefined;
      if (!hasWindow && q.dates !== true && q.dates !== 'true') {
        fail('logentries listing requires one of the parameters date, from, to or limit — an unfiltered listing could be silently truncated. Use dates=true for a day-calendar summary.');
      }

      if (q.dates === true || q.dates === 'true') {
        const dates = await listDates(q);
        return buildCalendar(dates);
      }

      let limit;
      if (q.limit !== undefined) {
        limit = Number(q.limit);
        if (!Number.isInteger(limit) || limit < 1) {
          fail('limit must be a positive integer');
        }
      }

      const normalized = { ...q };
      if (q.bbox !== undefined) {
        normalized.bbox = parseBbox(q.bbox);
      }

      const dates = await listDates(q);
      let entries = await collectEntries(dates);

      if (q.from) {
        const from = new Date(q.from).getTime();
        entries = entries.filter((entry) => entry.datetime.getTime() >= from);
      }
      if (q.to) {
        const to = new Date(q.to).getTime();
        entries = entries.filter((entry) => entry.datetime.getTime() <= to);
      }
      entries = entries.filter((entry) => entryMatches(entry, normalized));

      // limit selects the N newest matches, presented ascending
      if (limit !== undefined) {
        entries.sort((a, b) => b.datetime - a.datetime);
        entries = entries.slice(0, limit);
      }
      // Chronological ascending by datetime, ids break ties
      entries.sort((a, b) => {
        if (a.datetime.getTime() !== b.datetime.getTime()) {
          return a.datetime.getTime() - b.datetime.getTime();
        }
        if (a.id < b.id) {
          return -1;
        }
        return a.id > b.id ? 1 : 0;
      });

      const resources = {};
      entries.forEach((entry) => {
        resources[entry.id] = withSource(storageToApi(entry));
      });
      return resources;
    },

    async getResource(id, property) {
      if (!isUuid(id)) {
        fail('logentries resource ids must be UUIDs');
      }
      let stored;
      try {
        stored = await log.getEntryById(id);
      } catch (err) {
        if (err.code === 'ENOENT') {
          throw notFound(id);
        }
        throw err;
      }
      const entry = withSource(storageToApi(stored));
      if (property) {
        const value = property.split('.').reduce((acc, key) => (acc ? acc[key] : undefined), entry);
        if (value === undefined) {
          throw notFound(`${id}.${property}`);
        }
        return value;
      }
      return entry;
    },

    async setResource(id, value) {
      if (!isUuid(id)) {
        fail('logentries resource ids must be UUIDs');
      }
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        fail('entry must be an object');
      }
      if (value.id && value.id !== id) {
        fail('payload id must equal the resource id');
      }
      if (typeof value.text !== 'string') {
        fail('text is required');
      }
      // Create-or-replace: the stored entry decides which. A field the
      // payload omits keeps its stored value on a replace and gets its
      // create default only when there is nothing stored.
      const existing = await log.getEntryById(id).catch((err) => {
        if (err.code === 'ENOENT') {
          return null;
        }
        throw err;
      });

      let datetime;
      if (value.datetime !== undefined) {
        const parsed = new Date(value.datetime);
        if (Number.isNaN(parsed.getTime())) {
          fail('datetime must be an RFC 3339 datetime');
        }
        datetime = parsed.toISOString();
      } else if (existing) {
        datetime = new Date(existing.datetime).toISOString();
      } else {
        datetime = new Date().toISOString();
      }

      const now = new Date();
      const apiEntry = {
        ...value,
        id,
        datetime,
        timestamp: now.toISOString(),
      };
      if (value.origin !== undefined) {
        apiEntry.origin = value.origin;
      } else if (existing && existing.origin !== undefined) {
        // An API edit must not turn a manual line into an agent one
        apiEntry.origin = existing.origin;
      } else {
        apiEntry.origin = 'agent';
      }
      if (value.author !== undefined) {
        apiEntry.author = value.author;
      } else if (existing && existing.author !== undefined) {
        apiEntry.author = existing.author;
      } else {
        apiEntry.author = '';
      }
      if (value.telemetry === undefined && existing) {
        // Preserve the stored snapshot: the payload says nothing about it
        const stored = storageToApi(existing);
        if (stored.telemetry !== undefined) {
          apiEntry.telemetry = stored.telemetry;
        }
      }

      // Enrichment: a create fills the paths its telemetry array omits
      // (unless `enrich: false` — the bulk path); a replace is taken as
      // sent so that removing a path is one PUT, unless it explicitly
      // asks for fills with `enrich: true`. Read-only, never fails the
      // write.
      const shouldEnrich = existing ? value.enrich === true : value.enrich !== false;
      let enriched = apiEntry;
      if (shouldEnrich) {
        const atMs = Date.parse(datetime);
        const snapshot = bufferLookup && atMs >= now.getTime() - BUFFER_TIER_MINUTES * 60 * 1000
          ? bufferLookup(atMs, now.getTime())
          : null;
        let historyApi = null;
        if (app && typeof app.getHistoryApi === 'function') {
          try {
            // getHistoryApi may return a promise (newer servers) or the
            // api object directly (older ones); await covers both.
            historyApi = (await app.getHistoryApi()) || null;
          } catch (err) {
            historyApi = null;
          }
        }
        enriched = await enrichEntry(apiEntry, {
          now: now.getTime(),
          snapshot,
          enginePaths: enginePaths ? enginePaths() : [],
          historyApi,
          historyTimeoutMs,
        });
      }

      const storageEntry = apiToStorage(enriched);
      await log.upsertEntry(id, storageEntry);
    },

    async deleteResource(id) {
      if (!isUuid(id)) {
        fail('logentries resource ids must be UUIDs');
      }
      try {
        await log.deleteEntryById(id);
      } catch (err) {
        if (err.code === 'ENOENT') {
          throw notFound(id);
        }
        throw err;
      }
    },
  };
}

module.exports = {
  createLogentriesProvider,
  isUuid,
};
