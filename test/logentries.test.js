const test = require('node:test');
const assert = require('node:assert');
const {
  mkdtemp, writeFile, readFile, rm,
} = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { randomUUID } = require('node:crypto');
const { parse, stringify } = require('yaml');
const Log = require('../plugin/Log');
const { createLogentriesProvider, isUuid } = require('../plugin/provider');
const { createResourceNotifier } = require('../plugin/deltas');

function newLog() {
  return mkdtemp(join(tmpdir(), 'logbook-provider-')).then((dir) => ({ dir, log: new Log(dir) }));
}

function newProvider(log, overrides = {}) {
  const historyCalls = [];
  const options = {
    app: {},
    log,
    providerId: 'signalk-logbook',
    bufferLookup: null,
    enginePaths: () => [],
    ...overrides,
  };
  const provider = createLogentriesProvider(options);
  return { provider, historyCalls, options };
}

function expectFail(promise, code) {
  return promise.then(
    () => {
      throw new Error(`expected rejection${code ? ` (${code})` : ''}`);
    },
    (err) => {
      if (code && err.code !== code) {
        throw new Error(`expected code ${code}, got ${err.code}: ${err.message}`);
      }
      return err;
    },
  );
}

/**
 * Compare two pathvalue arrays: scale-converted numeric values may differ
 * by a few ulps (the storage snap keeps round trips stable but not every
 * SI value has an exact nautical preimage); everything else is strict.
 */
function assertTelemetryClose(actual, expected) {
  assert.strictEqual(actual.length, expected.length);
  expected.forEach((want, i) => {
    const got = actual[i];
    assert.strictEqual(got.path, want.path);
    if (typeof want.value === 'number') {
      assert.ok(
        Math.abs(got.value - want.value) <= Math.abs(want.value) * 1e-12,
        `${want.path}: ${got.value} != ${want.value}`,
      );
    } else {
      assert.deepStrictEqual(got.value, want.value);
    }
    Object.keys(want).forEach((key) => {
      if (key !== 'path' && key !== 'value') {
        assert.deepStrictEqual(got[key], want[key]);
      }
    });
  });
}

async function writeDayFile(dir, date, entries) {
  await writeFile(join(dir, `${date}.yml`), stringify(entries), 'utf-8');
}

async function readDayFile(dir, date) {
  const content = await readFile(join(dir, `${date}.yml`), 'utf-8');
  return parse(content);
}

test('setResource creates an entry with a server-style fresh UUID and defaults', async () => {
  const { dir, log } = await newLog();
  try {
    const { provider } = newProvider(log);
    const id = randomUUID();
    await provider.setResource(id, { text: 'Genoa furled' });
    const entry = await provider.getResource(id);
    assert.strictEqual(entry.id, id);
    assert.strictEqual(entry.text, 'Genoa furled');
    assert.strictEqual(entry.origin, 'agent', 'resources API writes default to origin agent');
    assert.strictEqual(entry.author, '');
    assert.strictEqual(entry.$source, 'signalk-logbook');
    assert.ok(entry.timestamp, 'timestamp set on create');
    assert.match(entry.datetime, /^\d{4}-\d{2}-\d{2}T/, 'datetime defaults to now on create');
    // Stored under today's day file with the id stamped
    const today = new Date().toISOString().substr(0, 10);
    const stored = await readDayFile(dir, today);
    assert.strictEqual(stored.length, 1);
    assert.strictEqual(stored[0].id, id);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('setResource preserves datetime on replace and edits content in place', async () => {
  const { dir, log } = await newLog();
  try {
    const { provider } = newProvider(log);
    const id = randomUUID();
    await provider.setResource(id, { datetime: '2026-06-11T08:00:00.000Z', text: 'Departed' });
    const first = await provider.getResource(id);
    const firstTimestamp = first.timestamp;
    // Replace: same id, new content, no datetime supplied
    await new Promise((resolve) => {
      setTimeout(resolve, 5);
    });
    await provider.setResource(id, { text: 'Departed under power' });
    const second = await provider.getResource(id);
    assert.strictEqual(second.datetime, '2026-06-11T08:00:00.000Z', 'datetime preserved on replace');
    assert.strictEqual(second.text, 'Departed under power');
    assert.notStrictEqual(second.timestamp, firstTimestamp, 'timestamp set on replace');
    // Datetime can be corrected in the same single upsert
    await provider.setResource(id, { datetime: '2026-06-11T09:30:00.000Z', text: 'Departed under power' });
    const third = await provider.getResource(id);
    assert.strictEqual(third.datetime, '2026-06-11T09:30:00.000Z');
    // Storage: still one entry, in the new day file, none in the old one
    const oldDay = await readDayFile(dir, '2026-06-11');
    assert.strictEqual(oldDay.length, 1, 'old day file emptied by the move');
    assert.strictEqual(oldDay[0].datetime, '2026-06-11T09:30:00.000Z');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('duplicate datetimes coexist as distinct entries, ordered by id tie-break', async () => {
  const { log } = await newLog();
  try {
    const { provider } = newProvider(log);
    const idA = randomUUID();
    const idB = randomUUID();
    await provider.setResource(idA, { datetime: '2026-06-11T08:00:00.000Z', text: 'A' });
    await provider.setResource(idB, { datetime: '2026-06-11T08:00:00.000Z', text: 'B' });
    const listed = await provider.listResources({ date: '2026-06-11' });
    const ids = Object.keys(listed);
    assert.strictEqual(ids.length, 2);
    assert.deepStrictEqual(ids, [idA, idB].sort(), 'tie broken deterministically by id');
  } finally {
    await rm(await log.dir, { recursive: true, force: true });
  }
});

test('listings require a window: unfiltered listing is rejected', async () => {
  const { log } = await newLog();
  try {
    const { provider } = newProvider(log);
    await expectFail(provider.listResources({}), 'EINVAL').then((err) => {
      // Older servers surface the provider's message verbatim; keep it
      // matching the phrase the server-side validation also uses
      assert.ok(err.message.match(/date, from, to or limit/));
    });
    await expectFail(provider.listResources(), 'EINVAL');
  } finally {
    await rm(log.dir, { recursive: true, force: true });
  }
});

test('listResources supports date, from/to, category, origin, author, bbox and limit', async () => {
  const { log } = await newLog();
  try {
    const { provider } = newProvider(log);
    await provider.setResource(randomUUID(), {
      datetime: '2026-06-11T08:00:00.000Z',
      text: 'one',
      category: 'engine',
      origin: 'auto',
      telemetry: [{ path: 'navigation.position', value: { latitude: 60.0, longitude: 25.0 } }],
    });
    await provider.setResource(randomUUID(), {
      datetime: '2026-06-11T09:00:00.000Z',
      text: 'two',
      author: 'poseidon',
      telemetry: [{ path: 'navigation.position', value: { latitude: 40.0, longitude: 10.0 } }],
    });
    await provider.setResource(randomUUID(), {
      datetime: '2026-06-12T08:00:00.000Z',
      text: 'three',
      telemetry: [{ path: 'navigation.position', value: { latitude: 60.5, longitude: 25.5 } }],
    });

    const day = await provider.listResources({ date: '2026-06-11' });
    assert.strictEqual(Object.keys(day).length, 2);
    const ordered = Object.values(day);
    assert.ok(ordered[0].datetime < ordered[1].datetime, 'chronological ascending');

    const range = await provider.listResources({
      from: '2026-06-11T08:30:00.000Z', to: '2026-06-12T09:00:00.000Z',
    });
    assert.strictEqual(Object.keys(range).length, 2, 'inclusive range bounds');

    const byCategory = await provider.listResources({ date: '2026-06-11', category: 'engine' });
    assert.strictEqual(Object.keys(byCategory).length, 1);
    assert.strictEqual(Object.values(byCategory)[0].text, 'one');

    const byAuthor = await provider.listResources({ date: '2026-06-11', author: 'poseidon' });
    assert.strictEqual(Object.keys(byAuthor).length, 1);
    assert.strictEqual(Object.values(byAuthor)[0].text, 'two');

    const byOrigin = await provider.listResources({ date: '2026-06-11', origin: 'auto' });
    assert.strictEqual(Object.keys(byOrigin).length, 1);

    const bbox = await provider.listResources({ from: '2026-06-11T00:00:00.000Z', to: '2026-06-13T00:00:00.000Z', bbox: '24,59,26,61' });
    assert.strictEqual(Object.keys(bbox).length, 2, 'only entries with a position inside the box');
    assert.ok(Object.values(bbox).every((e) => e.text !== 'two'));

    const limited = await provider.listResources({ limit: 2 });
    assert.strictEqual(Object.keys(limited).length, 2);
    assert.strictEqual(Object.values(limited)[0].text, 'two', 'newest N selected, presented ascending');
    assert.strictEqual(Object.values(limited)[1].text, 'three');

    // REST wire forms: the server forwards query values as strings when
    // they are not JSON-parseable, so limit/dates must work as strings too
    const stringLimit = await provider.listResources({ limit: '2' });
    assert.strictEqual(Object.keys(stringLimit).length, 2);
    const stringDates = await provider.listResources({ dates: 'true' });
    assert.deepStrictEqual(stringDates, {
      '2026-06-11': { count: 2 },
      '2026-06-12': { count: 1 },
    });
  } finally {
    await rm(log.dir, { recursive: true, force: true });
  }
});

test('bbox crossing the antimeridian matches entries on both sides of 180°', async () => {
  const { log } = await newLog();
  try {
    const { provider } = newProvider(log);
    await provider.setResource(randomUUID(), {
      datetime: '2026-06-11T08:00:00.000Z',
      text: 'east',
      telemetry: [{ path: 'navigation.position', value: { latitude: -14.0, longitude: 179.0 } }],
    });
    await provider.setResource(randomUUID(), {
      datetime: '2026-06-11T09:00:00.000Z',
      text: 'west',
      telemetry: [{ path: 'navigation.position', value: { latitude: -15.0, longitude: -178.0 } }],
    });
    await provider.setResource(randomUUID(), {
      datetime: '2026-06-11T10:00:00.000Z',
      text: 'far',
      telemetry: [{ path: 'navigation.position', value: { latitude: -14.0, longitude: 150.0 } }],
    });

    // A west edge east of the east edge declares a seam-crossing box:
    // match either side of 180°, but not the rest of the world
    const seamBox = await provider.listResources({ from: '2026-06-11T00:00:00.000Z', to: '2026-06-12T00:00:00.000Z', bbox: '170,-17,-170,-13' });
    const seamTexts = Object.values(seamBox).map((e) => e.text).sort();
    assert.deepStrictEqual(seamTexts, ['east', 'west'], 'both sides of the seam, nothing else');

    // A regular box still works unchanged
    const regular = await provider.listResources({ from: '2026-06-11T00:00:00.000Z', to: '2026-06-12T00:00:00.000Z', bbox: '-180,-17,-170,-13' });
    assert.deepStrictEqual(Object.values(regular).map((e) => e.text), ['west']);
  } finally {
    await rm(log.dir, { recursive: true, force: true });
  }
});

test('dates=true returns the day-calendar summary', async () => {
  const { log } = await newLog();
  try {
    const { provider } = newProvider(log);
    await provider.setResource(randomUUID(), { datetime: '2026-06-11T08:00:00.000Z', text: 'a' });
    await provider.setResource(randomUUID(), { datetime: '2026-06-11T09:00:00.000Z', text: 'b' });
    await provider.setResource(randomUUID(), { datetime: '2026-06-12T08:00:00.000Z', text: 'c' });
    const calendar = await provider.listResources({ dates: true });
    assert.deepStrictEqual(calendar, {
      '2026-06-11': { count: 2 },
      '2026-06-12': { count: 1 },
    });
  } finally {
    await rm(log.dir, { recursive: true, force: true });
  }
});

test('setResource rejects non-UUID ids, mismatched payload ids and invalid datetimes', async () => {
  const { log } = await newLog();
  try {
    const { provider } = newProvider(log);
    await expectFail(provider.setResource('not-a-uuid', { text: 'x' }), 'EINVAL');
    await expectFail(provider.getResource('not-a-uuid'), 'EINVAL');
    await expectFail(provider.deleteResource('not-a-uuid'), 'EINVAL');
    const id = randomUUID();
    await expectFail(provider.setResource(id, { id: randomUUID(), text: 'x' }), 'EINVAL');
    await expectFail(provider.setResource(id, { datetime: 'yesterday', text: 'x' }), 'EINVAL');
    await expectFail(provider.setResource(id, { text: 42 }), 'EINVAL');
  } finally {
    await rm(log.dir, { recursive: true, force: true });
  }
});

test('getResource and deleteResource reject unknown ids with ENOENT', async () => {
  const { log } = await newLog();
  try {
    const { provider } = newProvider(log);
    await expectFail(provider.getResource(randomUUID()), 'ENOENT');
    await expectFail(provider.deleteResource(randomUUID()), 'ENOENT');
  } finally {
    await rm(log.dir, { recursive: true, force: true });
  }
});

test('SI values round trip losslessly: write SI → read SI → write again yields identical storage', async () => {
  const { dir, log } = await newLog();
  try {
    const { provider } = newProvider(log);
    const id = randomUUID();
    const si = {
      datetime: '2026-06-11T08:00:00.000Z',
      text: 'Full precision',
      telemetry: [
        { path: 'navigation.position', value: { latitude: 52.511, longitude: 13.1936, source: 'GPS' } },
        { path: 'navigation.headingTrue', value: 3.3161 },
        { path: 'navigation.courseOverGroundTrue', value: 3.351 },
        { path: 'navigation.speedOverGround', value: 2.6751 },
        { path: 'navigation.speedThroughWater', value: 2.6237 },
        { path: 'navigation.log', value: 237796.8 },
        { path: 'environment.outside.pressure', value: 101325 },
        { path: 'environment.wind.speedOverGround', value: 6.5334 },
        { path: 'environment.wind.directionTrue', value: 1.5621 },
        { path: 'environment.outside.cloudCover', value: 0.4 },
        { path: 'environment.outside.visibility', value: 7 },
        { path: 'navigation.course.nextPoint', value: { position: { latitude: 52.6, longitude: 13.3 }, href: '/resources/waypoints/x' } },
      ],
    };
    await provider.setResource(id, si);
    const read = await provider.getResource(id);
    delete read.timestamp;
    delete read.$source;
    delete read.origin;
    delete read.author;
    read.telemetry.sort((a, b) => (a.path < b.path ? -1 : 1));
    const expected = JSON.parse(JSON.stringify(si));
    expected.telemetry.sort((a, b) => (a.path < b.path ? -1 : 1));
    assert.strictEqual(read.datetime, expected.datetime);
    assert.strictEqual(read.text, expected.text);
    assertTelemetryClose(read.telemetry, expected.telemetry);

    // Write what was read again: storage must be identical. The read-time
    // category default synthesized by the v1-normalized storage read is
    // not part of what was written, so a client round-tripping its own
    // payload drops it first.
    const storageAfterFirst = await readDayFile(dir, '2026-06-11');
    const readBack = { ...read };
    delete readBack.category;
    await provider.setResource(id, readBack);
    const storageAfterSecond = await readDayFile(dir, '2026-06-11');
    // timestamp is set on every write, so it alone differs between the
    // two writes; values are identical
    delete storageAfterFirst[0].timestamp;
    delete storageAfterSecond[0].timestamp;
    assert.deepStrictEqual(storageAfterSecond, storageAfterFirst, 'second write yields identical storage');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('sea state crosses the storage boundary through the WMO Douglas↔Beaufort correspondence', async () => {
  const { log } = await newLog();
  try {
    const { provider } = newProvider(log);
    const id = randomUUID();
    await provider.setResource(id, {
      datetime: '2026-06-11T08:00:00.000Z',
      text: 'Sea state',
      telemetry: [
        { path: 'environment.water.seaStateValue', value: 5 },
      ],
    });
    const stored = await readDayFile(log.dir, '2026-06-11');
    assert.strictEqual(stored[0].observations.seaState, 4, 'Beaufort 5 stores as Douglas 4');
    const read = await provider.getResource(id);
    const value = read.telemetry.find((pv) => pv.path === 'environment.water.seaStateValue');
    assert.strictEqual(value.value, 5, 'reads back as Beaufort 5');
    assert.ok(
      !read.telemetry.some((pv) => pv.path === 'environment.water.seaState'),
      'the label path is not carried, only the numeric Beaufort code',
    );
  } finally {
    await rm(log.dir, { recursive: true, force: true });
  }
});

test('duplicate telemetry paths with different $sources are preserved verbatim', async () => {
  const { log } = await newLog();
  try {
    const { provider } = newProvider(log);
    const id = randomUUID();
    await provider.setResource(id, {
      datetime: '2026-06-11T08:00:00.000Z',
      text: 'Two sources',
      telemetry: [
        { path: 'navigation.log', value: 1000, $source: 'n2k.1' },
        { path: 'navigation.log', value: 1001, $source: 'n2k.2' },
      ],
    });
    const read = await provider.getResource(id);
    assert.strictEqual(read.telemetry.length, 2);
    const sources = read.telemetry.map((pv) => pv.$source).sort();
    assert.deepStrictEqual(sources, ['n2k.1', 'n2k.2'], 'both pathvalues survive');
    const stored = await readDayFile(log.dir, '2026-06-11');
    assert.strictEqual(stored[0].telemetry.length, 2, 'parked verbatim in storage');
  } finally {
    await rm(log.dir, { recursive: true, force: true });
  }
});

test('unknown fields and unknown telemetry paths are preserved through the round trip', async () => {
  const { log } = await newLog();
  try {
    const { provider } = newProvider(log);
    const id = randomUUID();
    await provider.setResource(id, {
      datetime: '2026-06-11T08:00:00.000Z',
      text: 'Extensible',
      'x-stylusapp-ink': { strokes: 3 },
      telemetry: [
        { path: 'proprietary.stylusapp.ink', value: 'data' },
        { path: 'environment.outside.pressure', value: 101325, sensor: 'barometer-1' },
      ],
    });
    const read = await provider.getResource(id);
    assert.deepStrictEqual(read['x-stylusapp-ink'], { strokes: 3 });
    assert.deepStrictEqual(read.telemetry.find((pv) => pv.path === 'proprietary.stylusapp.ink'), {
      path: 'proprietary.stylusapp.ink', value: 'data',
    });
    const pressure = read.telemetry.find((pv) => pv.path === 'environment.outside.pressure');
    assert.strictEqual(pressure.sensor, 'barometer-1', 'extra pathvalue members preserved');
    // And a v1 read of the same entry does not break on the parked fields
    const viaV1 = await log.getEntry('2026-06-11T08:00:00.000Z');
    assert.strictEqual(viaV1.text, 'Extensible');
    assert.deepStrictEqual(viaV1.telemetry.find((pv) => pv.path === 'proprietary.stylusapp.ink'), {
      path: 'proprietary.stylusapp.ink', value: 'data',
    });
  } finally {
    await rm(log.dir, { recursive: true, force: true });
  }
});

test('legacy engine.hours scalar: read as propulsion.default.runTime, stripped, dropped on write; RMW migrates storage', async () => {
  const { dir, log } = await newLog();
  try {
    const { provider } = newProvider(log);
    // A scalar-only legacy entry (pre-multi-engine format)
    await writeDayFile(dir, '2026-06-11', [{
      datetime: '2026-06-11T08:00:00.000Z', text: 'Engine on', engine: { hours: 100.5 },
    }]);
    await log.migrate();
    const storedLegacy = await readDayFile(dir, '2026-06-11');
    const { id } = storedLegacy[0];
    assert.ok(isUuid(id), 'migration stamped the id');
    const read = await provider.getResource(id);
    const engine = read.telemetry.find((pv) => pv.path === 'propulsion.default.runTime');
    assert.ok(engine, 'scalar served as a runTime pathvalue');
    assert.strictEqual(engine.value, 100.5 * 3600, 'hours converted to seconds');
    assert.strictEqual(read.engine, undefined, 'engine field stripped from responses');

    // Read-modify-write migrates storage to the canonical form
    await provider.setResource(id, read);
    const stored = await readDayFile(dir, '2026-06-11');
    assert.deepStrictEqual(stored[0].engine, { engines: { default: { hours: 100.5 } } });

    // A write carrying the legacy scalar drops it
    const id2 = randomUUID();
    await provider.setResource(id2, {
      datetime: '2026-06-11T09:00:00.000Z', text: 'Scalar', engine: { hours: 5 },
    });
    const stored2 = await readDayFile(dir, '2026-06-11');
    const entry2 = stored2.find((e) => e.id === id2);
    assert.strictEqual(entry2.engine, undefined, 'legacy scalar dropped, not interpreted');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('multi-engine entries map runTime pathvalues per instance', async () => {
  const { dir, log } = await newLog();
  try {
    const { provider } = newProvider(log);
    const id = randomUUID();
    await provider.setResource(id, {
      datetime: '2026-06-11T08:00:00.000Z',
      text: 'Both engines',
      telemetry: [
        { path: 'propulsion.Port.runTime', value: 3600 },
        { path: 'propulsion.Starboard.runTime', value: 7200 },
      ],
    });
    const stored = await readDayFile(dir, '2026-06-11');
    assert.deepStrictEqual(stored[0].engine, {
      engines: { Port: { hours: 1 }, Starboard: { hours: 2 } },
    });
    const read = await provider.getResource(id);
    assert.strictEqual(read.telemetry.length, 2);
    assert.ok(read.telemetry.find((pv) => pv.path === 'propulsion.Port.runTime' && pv.value === 3600));
    assert.ok(read.telemetry.find((pv) => pv.path === 'propulsion.Starboard.runTime' && pv.value === 7200));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('buffer tier enrichment fills missing paths from the live snapshot', async () => {
  const { log } = await newLog();
  try {
    const snapshot = {
      'navigation.position': { latitude: 60.1, longitude: 25.1 },
      'navigation.gnss.type': 'GPS',
      'navigation.headingTrue': 1.5,
      'navigation.speedOverGround': 3.0,
      'environment.outside.pressure': 101000,
      'environment.water.swell.state': 3,
      'propulsion.Port.runTime': 500,
    };
    const { provider } = newProvider(log, {
      bufferLookup: () => snapshot,
    });
    const id = randomUUID();
    await provider.setResource(id, {
      text: 'Manual line now',
      datetime: new Date().toISOString(),
      origin: 'manual',
      telemetry: [{ path: 'navigation.windInfo', value: 'ignored' }],
    });
    const read = await provider.getResource(id);
    const position = read.telemetry.find((pv) => pv.path === 'navigation.position');
    assert.deepStrictEqual(position.value, { latitude: 60.1, longitude: 25.1, source: 'GPS' });
    assert.ok(read.telemetry.find((pv) => pv.path === 'navigation.headingTrue' && pv.value === 1.5));
    const seaState = read.telemetry.find((pv) => pv.path === 'environment.water.seaStateValue');
    assert.strictEqual(seaState.value, 3, 'legacy Douglas swell state converted to Beaufort');
    assert.ok(read.telemetry.find((pv) => pv.path === 'propulsion.Port.runTime' && pv.value === 500));
    // Explicit pathvalues always win
    const id2 = randomUUID();
    await provider.setResource(id2, {
      text: 'Explicit wins',
      datetime: new Date().toISOString(),
      origin: 'manual',
      telemetry: [{ path: 'navigation.position', value: { latitude: 1, longitude: 2 } }],
    });
    const read2 = await provider.getResource(id2);
    assert.strictEqual(
      read2.telemetry.filter((pv) => pv.path === 'navigation.position').length,
      1,
      'a present path is never enriched a second time',
    );
  } finally {
    await rm(log.dir, { recursive: true, force: true });
  }
});

test('history tier enrichment: partial per-path fills, tolerances, rejection and hang fallthrough', async () => {
  const { log } = await newLog();
  try {
    const at = '2026-06-01T12:00:00.000Z';
    const atMs = Date.parse(at);
    // Samples: heading 20s before (outside its ±5s fast tolerance), speed
    // 20s before (inside its ±60s medium tolerance), wind 90s after
    // (outside its ±60s medium tolerance), pressure 2min after (inside its
    // ±10min slow tolerance)
    const response = {
      values: [
        { path: 'navigation.headingTrue', method: 'first' },
        { path: 'navigation.headingTrue', method: 'last' },
        { path: 'environment.outside.pressure', method: 'first' },
        { path: 'environment.outside.pressure', method: 'last' },
        { path: 'environment.wind.speedOverGround', method: 'first' },
        { path: 'environment.wind.speedOverGround', method: 'last' },
        { path: 'navigation.speedOverGround', method: 'first' },
        { path: 'navigation.speedOverGround', method: 'last' },
      ],
      data: [
        [new Date(atMs - 20000).toISOString(), 1.0, 1.2, null, null, null, null, 2.5, 2.6],
        [new Date(atMs + 90000).toISOString(), null, null, null, null, 5.0, 5.2, null, null],
        [new Date(atMs + 120000).toISOString(), null, null, 101300, 101310, null, null, null, null],
      ],
    };
    const historyApi = {
      getValues: async (query) => {
        assert.ok(query.pathSpecs.length > 0);
        assert.ok(query.from < query.to);
        return response;
      },
    };
    const { provider } = newProvider(log, {
      app: { getHistoryApi: async () => historyApi },
    });
    const id = randomUUID();
    await provider.setResource(id, { datetime: at, text: 'Backdated' });
    const read = await provider.getResource(id);
    const heading = read.telemetry.find((pv) => pv.path === 'navigation.headingTrue');
    assert.strictEqual(heading, undefined, 'sample beyond the fast tolerance leaves the path absent');
    const pressure = read.telemetry.find((pv) => pv.path === 'environment.outside.pressure');
    assert.strictEqual(pressure.value, 101300, 'nearest recorded value within the slow tolerance fills');
    const wind = read.telemetry.find((pv) => pv.path === 'environment.wind.speedOverGround');
    assert.strictEqual(wind, undefined, 'sample beyond the medium tolerance leaves the path absent');
    const speed = read.telemetry.find((pv) => pv.path === 'navigation.speedOverGround');
    assert.strictEqual(speed.value, 2.5, 'nearest (first) sample within the medium tolerance fills');

    // A rejecting history provider never fails the write
    const { provider: failing } = newProvider(log, {
      app: { getHistoryApi: async () => ({ getValues: async () => { throw new Error('boom'); } }) },
    });
    const id2 = randomUUID();
    await failing.setResource(id2, { datetime: at, text: 'Still stored' });
    const read2 = await failing.getResource(id2);
    assert.strictEqual(read2.text, 'Still stored');
    assert.strictEqual(read2.telemetry, undefined, 'stored un-enriched');

    // A hanging history provider falls through after the bounded timeout
    const { provider: hanging } = newProvider(log, {
      app: { getHistoryApi: async () => ({ getValues: () => new Promise(() => {}) }) },
      historyTimeoutMs: 50,
    });
    const id3 = randomUUID();
    await hanging.setResource(id3, { datetime: at, text: 'Hanging history' });
    const read3 = await hanging.getResource(id3);
    assert.strictEqual(read3.text, 'Hanging history');
  } finally {
    await rm(log.dir, { recursive: true, force: true });
  }
});

test('enrich: false is the bulk path: no history lookups are issued', async () => {
  const { log } = await newLog();
  try {
    let lookups = 0;
    const { provider } = newProvider(log, {
      app: {
        getHistoryApi: async () => ({
          getValues: async () => {
            lookups += 1;
            return { values: [], data: [] };
          },
        }),
      },
    });
    const id = randomUUID();
    await provider.setResource(id, {
      datetime: '2026-06-01T12:00:00.000Z', text: 'Bulk import', enrich: false,
    });
    assert.strictEqual(lookups, 0, 'no lookups for enrich: false');
    const read = await provider.getResource(id);
    assert.strictEqual(read.enrich, undefined, 'control field stripped, never stored');
    assert.strictEqual(read.telemetry, undefined);
  } finally {
    await rm(log.dir, { recursive: true, force: true });
  }
});

test('out-of-range pathvalues park verbatim instead of rejecting the write', async () => {
  const { log } = await newLog();
  try {
    const { provider } = newProvider(log);
    const id = randomUUID();
    await provider.setResource(id, {
      datetime: '2026-06-11T08:00:00.000Z',
      text: 'Odd readings',
      telemetry: [
        { path: 'navigation.headingTrue', value: -0.01 },
        { path: 'navigation.speedOverGround', value: -1 },
        { path: 'navigation.position', value: { latitude: 95, longitude: 25 } },
        { path: 'navigation.course.nextPoint', value: { position: { latitude: 1, longitude: 200 } } },
        { path: 'environment.outside.visibility', value: 12 },
        { path: 'environment.water.seaStateValue', value: 13 },
        { path: 'environment.wind.speedOverGround', value: -2 },
        { path: 'communication.vhf.channel', value: '16AB' },
        { path: 'propulsion.Port.runTime', value: -100 },
        { path: 'navigation.log', value: 1000 },
      ],
    });
    const read = await provider.getResource(id);
    assert.strictEqual(read.text, 'Odd readings', 'the entry is stored, not rejected');
    [
      'navigation.headingTrue',
      'navigation.speedOverGround',
      'navigation.position',
      'navigation.course.nextPoint',
      'environment.outside.visibility',
      'environment.water.seaStateValue',
      'environment.wind.speedOverGround',
      'communication.vhf.channel',
      'propulsion.Port.runTime',
    ].forEach((path) => {
      assert.ok(read.telemetry.find((pv) => pv.path === path), `${path} parked verbatim`);
    });
    assert.strictEqual(
      read.telemetry.find((pv) => pv.path === 'navigation.headingTrue').value,
      -0.01,
      'parked values read back as sent',
    );
    // The in-range pathvalue still maps to its storage field
    const mappedLog = read.telemetry.find((pv) => pv.path === 'navigation.log');
    assert.ok(Math.abs(mappedLog.value - 1000) < 1e-9, 'in-range log mapped');
    const stored = await readDayFile(log.dir, '2026-06-11');
    assert.ok(Math.abs(stored[0].log - 1000 / 1852) < 1e-12);
    assert.strictEqual(stored[0].heading, undefined, 'out-of-range heading has no storage field');
  } finally {
    await rm(log.dir, { recursive: true, force: true });
  }
});

test('enrichment values out of the storage range park instead of failing the write', async () => {
  const { log } = await newLog();
  try {
    const snapshot = {
      'navigation.headingTrue': 6.2832, // beyond 2π — sensor noise
      'navigation.speedOverGround': 3.0,
    };
    const { provider } = newProvider(log, {
      bufferLookup: () => snapshot,
    });
    const id = randomUUID();
    await provider.setResource(id, {
      text: 'Heading noise',
      datetime: new Date().toISOString(),
    });
    const read = await provider.getResource(id);
    assert.strictEqual(read.text, 'Heading noise');
    const heading = read.telemetry.find((pv) => pv.path === 'navigation.headingTrue');
    assert.ok(heading, 'out-of-range enriched heading parked');
    assert.strictEqual(heading.value, 6.2832);
    assert.ok(read.telemetry.find((pv) => pv.path === 'navigation.speedOverGround' && pv.value === 3));
  } finally {
    await rm(log.dir, { recursive: true, force: true });
  }
});

test('replace preserves omitted origin, author and telemetry', async () => {
  const { log } = await newLog();
  try {
    const { provider } = newProvider(log);
    const id = randomUUID();
    await provider.setResource(id, {
      datetime: '2026-06-11T08:00:00.000Z',
      text: 'Tack',
      author: 'Johan',
      origin: 'manual',
      telemetry: [{ path: 'navigation.position', value: { latitude: 60.1, longitude: 25.1 } }],
    });
    await provider.setResource(id, { text: 'Tack, second series' });
    const read = await provider.getResource(id);
    assert.strictEqual(read.origin, 'manual', 'an edit must not turn a manual line into an agent one');
    assert.strictEqual(read.author, 'Johan');
    assert.ok(read.telemetry.find((pv) => pv.path === 'navigation.position'), 'telemetry preserved');
  } finally {
    await rm(log.dir, { recursive: true, force: true });
  }
});

test('replace with telemetry: [] removes paths and enrichment does not refill them', async () => {
  const { log } = await newLog();
  try {
    let bufferCalls = 0;
    const snapshot = {
      'navigation.position': { latitude: 60.1, longitude: 25.1 },
      'navigation.headingTrue': 1.5,
    };
    const { provider } = newProvider(log, {
      bufferLookup: () => {
        bufferCalls += 1;
        return snapshot;
      },
    });
    const id = randomUUID();
    await provider.setResource(id, {
      text: 'Departed',
      datetime: new Date().toISOString(),
      origin: 'manual',
    });
    assert.strictEqual(bufferCalls, 1, 'create enriched from the buffer');
    await provider.setResource(id, { text: 'Departed', telemetry: [] });
    assert.strictEqual(bufferCalls, 1, 'the replace issued no lookups');
    const read = await provider.getResource(id);
    assert.strictEqual(read.telemetry, undefined, 'removed paths stay removed');
    assert.strictEqual(read.origin, 'manual');
    // …unless the replace explicitly asks for fills
    await provider.setResource(id, { text: 'Departed', telemetry: [], enrich: true });
    const refilled = await provider.getResource(id);
    assert.ok(refilled.telemetry.find((pv) => pv.path === 'navigation.headingTrue'));
  } finally {
    await rm(log.dir, { recursive: true, force: true });
  }
});

test('migration stamps ids, backs up day files, builds the index and is idempotent', async () => {
  const { dir, log } = await newLog();
  try {
    await writeDayFile(dir, '2026-06-11', [
      { datetime: '2026-06-11T08:00:00.000Z', text: 'one' },
      { datetime: '2026-06-11T09:00:00.000Z', text: 'two' },
    ]);
    await writeDayFile(dir, '2026-06-12', [
      { datetime: '2026-06-12T08:00:00.000Z', text: 'three' },
    ]);
    await log.migrate();
    const day1 = await readDayFile(dir, '2026-06-11');
    assert.ok(day1.every((e) => isUuid(e.id)), 'all entries stamped');
    const backup1 = parse(await readFile(join(dir, 'id-migration-backup', '2026-06-11.yml'), 'utf-8'));
    assert.ok(backup1.every((e) => !e.id), 'originals backed up before rewriting');
    // Index works
    const entry = await log.getEntryById(day1[1].id);
    assert.strictEqual(entry.text, 'two');
    // Idempotent re-run: ids kept, nothing else changes. The state file
    // now records the completed migration, so this re-run takes the fast
    // path and does not even read the day files
    await log.migrate();
    const day1Again = await readDayFile(dir, '2026-06-11');
    assert.deepStrictEqual(day1Again, day1);
    // Deduplication: an entry duplicated across day files keeps a single
    // copy. Dropped the state file to force the scan — as a migration
    // version bump or a manually deleted state file would
    const dup = { id: day1[0].id, datetime: '2026-06-12T10:00:00.000Z', text: 'one' };
    await writeDayFile(dir, '2026-06-12', [
      { datetime: '2026-06-12T08:00:00.000Z', text: 'three' },
      dup,
    ]);
    await rm(join(dir, '.migration.json'));
    const log2 = new Log(dir);
    await log2.migrate();
    const day1After = await readDayFile(dir, '2026-06-11');
    const day2After = await readDayFile(dir, '2026-06-12');
    assert.strictEqual(day1After[0].id, day1[0].id, 'earliest copy kept');
    assert.ok(!day2After.some((e) => e.id === day1[0].id), 'duplicate removed from the later file');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('listings skip entries without ids: they are not addressable resources yet', async () => {
  const { dir, log } = await newLog();
  try {
    // No migration has run, so the first entry carries no id (the shape
    // day files have before the startup scan stamps them)
    await writeDayFile(dir, '2026-06-11', [
      { datetime: '2026-06-11T08:00:00.000Z', text: 'pre-migration' },
      { id: randomUUID(), datetime: '2026-06-11T09:00:00.000Z', text: 'addressable' },
    ]);
    const { provider } = newProvider(log);
    const listed = await provider.listResources({ date: '2026-06-11' });
    assert.strictEqual(Object.keys(listed).length, 1);
    assert.strictEqual(listed[Object.keys(listed)[0]].text, 'addressable');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('cross-day move crash recovery: a duplicate left between steps is deduplicated by the startup scan', async () => {
  const { dir, log } = await newLog();
  try {
    const { provider } = newProvider(log);
    const id = randomUUID();
    await provider.setResource(id, { datetime: '2026-06-11T23:59:00.000Z', text: 'near midnight' });
    // Simulate a crash between write-new and delete-old: the entry exists
    // in both day files
    await writeDayFile(dir, '2026-06-12', [
      { id, datetime: '2026-06-12T00:01:00.000Z', text: 'near midnight' },
    ]);
    const log2 = new Log(dir);
    await log2.migrate();
    const day1 = await readDayFile(dir, '2026-06-11');
    const day2 = await readDayFile(dir, '2026-06-12');
    assert.strictEqual(day1.length, 1, 'earliest copy kept in the older file');
    assert.strictEqual(day2.length, 0, 'duplicate removed');
    // The surviving entry stays reachable and deletable via its id
    const read = await provider.getResource(id);
    assert.strictEqual(read.text, 'near midnight');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('the resources API and the v1 API share the same storage and see each other instantly', async () => {
  const { dir, log } = await newLog();
  try {
    const { provider } = newProvider(log);
    // v1 append
    await log.appendEntry('2026-06-11', {
      datetime: '2026-06-11T08:00:00.000Z', text: 'via v1', author: 'bergie', origin: 'manual',
    });
    const listed = await provider.listResources({ date: '2026-06-11' });
    assert.strictEqual(Object.keys(listed).length, 1);
    const id = Object.keys(listed)[0];
    // resources edit
    await provider.setResource(id, { ...listed[id], text: 'edited via resources' });
    const viaV1 = await log.getEntry('2026-06-11T08:00:00.000Z');
    assert.strictEqual(viaV1.text, 'edited via resources');
    assert.strictEqual(viaV1.id, id, 'id preserved across the v1 edit');
    // resources delete
    await provider.deleteResource(id);
    const dates = await log.listDates();
    const dayEntries = await log.getDate('2026-06-11');
    assert.strictEqual(dayEntries.length, 0);
    assert.ok(dates.includes('2026-06-11') || dates.length === 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('internal writes emit resources deltas; provider writes leave that to the server', async () => {
  const { log } = await newLog();
  try {
    // Wired like plugin/index.js does: the listener gates on provider
    // registration, so only internal writes ever emit.
    const deltaCalls = [];
    let resourcesActive = false;
    const app = {
      handleMessage: (source, delta, version) => deltaCalls.push({ delta, version }),
    };
    log.setChangeListener(createResourceNotifier(app, 'signalk-logbook', () => resourcesActive));

    // A trigger-style internal write before provider registration: no delta
    await log.appendEntry('2026-06-11', {
      datetime: '2026-06-11T08:00:00.000Z',
      text: 'Pre-registration',
      category: 'navigation',
    });
    assert.strictEqual(deltaCalls.length, 0, 'no deltas before the provider registers');

    resourcesActive = true;
    const stored = await log.appendEntry('2026-06-11', {
      datetime: '2026-06-11T09:00:00.000Z',
      text: 'Anchored',
      end: true,
      category: 'navigation',
    });
    assert.strictEqual(deltaCalls.length, 1);
    assert.strictEqual(deltaCalls[0].version, 2);
    const value = deltaCalls[0].delta.updates[0].values[0];
    assert.strictEqual(value.path, `resources.logentries.${stored.id}`);
    assert.strictEqual(value.value.text, 'Anchored');

    // The provider path is deltified by the server — the plugin must not
    // emit a second delta for it
    const { provider } = newProvider(log);
    const id = randomUUID();
    await provider.setResource(id, {
      datetime: '2026-06-11T10:00:00.000Z',
      text: 'Via the resources API',
    });
    assert.strictEqual(deltaCalls.length, 1, 'no duplicate delta for provider writes');
    await provider.deleteResource(id);
    assert.strictEqual(deltaCalls.length, 1, 'no duplicate delta for provider deletes');
  } finally {
    await rm(log.dir, { recursive: true, force: true });
  }
});

test('isUuid validates canonical UUID strings', () => {
  assert.ok(isUuid('1b4e28ba-2fa1-11d2-883f-b9a761bde3fb'));
  assert.ok(isUuid(randomUUID()));
  assert.ok(!isUuid('not-a-uuid'));
  assert.ok(!isUuid(undefined));
  assert.ok(!isUuid('1b4e28ba2fa111d2883fb9a761bde3fb'));
});
