const test = require('node:test');
const assert = require('node:assert');
const { apiToUiEntry, uiEntryToApi, draftToApiEntry } = require('../src/helpers/entries');

// An API entry as the logentries resources API serves it: SI units,
// telemetry pathvalues, provider $source and timestamp
function apiEntry(overrides = {}) {
  return {
    id: '1b4e28ba-2fa1-11d2-883f-b9a761bde3fb',
    datetime: '2026-06-11T08:00:00.000Z',
    text: 'Full snapshot',
    telemetry: [
      { path: 'navigation.position', value: { latitude: 60.1, longitude: 25.1, source: 'GPS' } },
      { path: 'navigation.headingTrue', value: 1.5 },
      { path: 'navigation.speedOverGround', value: 3.0 },
      { path: 'navigation.log', value: 237796.8 },
      { path: 'environment.outside.pressure', value: 101325 },
      { path: 'environment.wind.speedOverGround', value: 6.5334 },
      { path: 'environment.wind.directionTrue', value: 1.5621 },
      { path: 'environment.water.seaState', value: 5 },
      { path: 'environment.outside.cloudCover', value: 0.5 },
      { path: 'environment.outside.visibility', value: 7 },
      { path: 'communication.vhf.channel', value: '16' },
      { path: 'propulsion.Port.runTime', value: 36000 },
    ],
    origin: 'agent',
    category: 'navigation',
    timestamp: '2026-06-11T08:00:02.000Z',
    $source: 'signalk-logbook',
    ...overrides,
  };
}

test('apiToUiEntry converts to the nautical shape the UI components render', () => {
  const ui = apiToUiEntry(apiEntry());
  assert.strictEqual(ui.id, '1b4e28ba-2fa1-11d2-883f-b9a761bde3fb');
  assert.strictEqual(ui.datetime, '2026-06-11T08:00:00.000Z');
  assert.strictEqual(ui.text, 'Full snapshot');
  assert.deepStrictEqual(ui.position, { latitude: 60.1, longitude: 25.1, source: 'GPS' });
  assert.strictEqual(Math.round(ui.heading), 86, 'radians to degrees');
  assert.ok(ui.speed.sog > 5.8 && ui.speed.sog < 5.9, 'm/s to knots');
  assert.ok(Math.abs(ui.log - 128.4) < 0.05, 'meters to nautical miles');
  assert.strictEqual(ui.barometer, 1013.25, 'Pa to hPa');
  assert.strictEqual(ui.observations.seaState, 4, 'Beaufort 5 reads as Douglas 4');
  assert.strictEqual(ui.observations.cloudCoverage, 4, 'ratio 0.5 reads as 4 oktas');
  assert.strictEqual(ui.observations.visibility, 7);
  assert.strictEqual(ui.vhf, '16');
});

test('apiToUiEntry mirrors a single engine instance to the scalar the UI renders', () => {
  const ui = apiToUiEntry(apiEntry());
  assert.strictEqual(ui.engine.hours, 10, 'scalar mirrored from the engines map');
  assert.strictEqual(ui.engine.engines.Port.hours, 10);
  // Two engines: no mirroring, the multi-engine rendering path applies
  const twin = apiToUiEntry({
    ...apiEntry(),
    telemetry: [
      { path: 'propulsion.Port.runTime', value: 36000 },
      { path: 'propulsion.Starboard.runTime', value: 7200 },
    ],
  });
  assert.strictEqual(twin.engine.hours, undefined);
  assert.strictEqual(twin.engine.engines.Starboard.hours, 2);
});

test('uiEntryToApi strips UI-only fields and converts back to SI pathvalues', () => {
  const ui = {
    ...apiToUiEntry(apiEntry()),
    point: { latitude: 60.1, longitude: 25.1 },
    date: new Date('2026-06-11T08:00:00.000Z'),
    ago: 0,
    when: 'specific',
    timeMode: 'specific',
  };
  const api = uiEntryToApi(ui);
  assert.strictEqual(api.point, undefined);
  assert.strictEqual(api.date, undefined);
  assert.strictEqual(api.ago, undefined);
  assert.strictEqual(api.when, undefined);
  assert.strictEqual(api.timeMode, undefined);
  assert.strictEqual(api.id, '1b4e28ba-2fa1-11d2-883f-b9a761bde3fb');
  const log = api.telemetry.find((pv) => pv.path === 'navigation.log');
  assert.ok(Math.abs(log.value - 237796.8) < 1e-6, 'converted back to meters');
  const engine = api.telemetry.find((pv) => pv.path === 'propulsion.Port.runTime');
  assert.strictEqual(engine.value, 36000, 'hours back to seconds');
  // The scalar mirror is not written back as a pathvalue
  assert.strictEqual(
    api.telemetry.filter((pv) => pv.path.startsWith('propulsion.')).length,
    1,
  );
});

test('uiEntryToApi output round-trips back to the same UI shape', () => {
  const ui = apiToUiEntry(apiEntry());
  const api = uiEntryToApi(ui);
  const back = apiToUiEntry(api);
  assert.deepStrictEqual(back.position, ui.position);
  assert.deepStrictEqual(back.observations, ui.observations);
  assert.deepStrictEqual(back.speed, ui.speed);
  assert.strictEqual(back.heading, ui.heading);
  assert.strictEqual(back.vhf, ui.vhf);
  assert.deepStrictEqual(back.engine, ui.engine);
});

test('draftToApiEntry resolves datetime from ago and defaults origin to manual', () => {
  const now = new Date('2026-06-11T12:00:00.000Z');
  const draft = {
    text: 'Sail change',
    ago: 5,
    category: 'navigation',
  };
  const api = draftToApiEntry(draft, now);
  assert.strictEqual(api.datetime, '2026-06-11T11:55:00.000Z');
  assert.strictEqual(api.origin, 'manual', 'resources API defaults to agent, the UI overrides');
  const nowDraft = draftToApiEntry({ text: 'Now', ago: 0 }, now);
  assert.strictEqual(nowDraft.datetime, '2026-06-11T12:00:00.000Z');
  // An explicit datetime from the specific-time picker wins
  const specific = draftToApiEntry({
    text: 'Earlier', datetime: '2026-06-11T09:30:00.000Z', ago: 0,
  }, now);
  assert.strictEqual(specific.datetime, '2026-06-11T09:30:00.000Z');
  // An explicit origin from the draft is kept
  const agent = draftToApiEntry({ text: 'x', ago: 0, origin: 'agent' }, now);
  assert.strictEqual(agent.origin, 'agent');
});
