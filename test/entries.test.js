const test = require('node:test');
const assert = require('node:assert');
const {
  apiToUiEntry,
  uiEntryToApi,
  draftToApiEntry,
  EDITABLE_PATHS,
} = require('../src/helpers/entries');

// An API entry as the logentries resources API serves it: SI units,
// telemetry pathvalues, provider $source and timestamp
function apiEntry(overrides = {}) {
  return {
    id: '1b4e28ba-2fa1-11d2-883f-b9a761bde3fb',
    datetime: '2026-06-11T08:00:00.000Z',
    text: 'Full snapshot',
    telemetry: [
      { path: 'navigation.position', value: { latitude: 60.1, longitude: 25.1, source: 'GPS' } },
      { path: 'navigation.headingTrue', value: 3.3161 },
      { path: 'navigation.speedOverGround', value: 2.6751 },
      { path: 'navigation.log', value: 237796.8 },
      { path: 'environment.outside.pressure', value: 101325 },
      { path: 'environment.water.seaStateValue', value: 5 },
      { path: 'environment.outside.cloudCover', value: 0.5 },
      { path: 'communication.vhf.channel', value: '16' },
      { path: 'propulsion.Port.runTime', value: 36000 },
      { path: 'x-custom.thing', value: 42 },
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
  assert.ok(Math.abs(ui.heading - 190) < 0.5, 'radians to degrees');
  assert.ok(ui.speed.sog > 5.1 && ui.speed.sog < 5.3, 'm/s to knots');
  assert.ok(Math.abs(ui.log - 128.4) < 0.05, 'meters to nautical miles');
  assert.strictEqual(ui.barometer, 1013.25, 'Pa to hPa');
  assert.strictEqual(ui.observations.seaState, 4, 'Beaufort 5 reads as Douglas 4');
  assert.strictEqual(ui.observations.cloudCoverage, 4, 'ratio 0.5 reads as 4 oktas');
  assert.strictEqual(ui.vhf, '16');
});

test('apiToUiEntry keeps the original SI telemetry for display and write-back', () => {
  const ui = apiToUiEntry(apiEntry());
  assert.ok(Array.isArray(ui._telemetry));
  const log = ui._telemetry.find((pv) => pv.path === 'navigation.log');
  assert.strictEqual(log.value, 237796.8, 'full precision SI carried along');
  const custom = ui._telemetry.find((pv) => pv.path === 'x-custom.thing');
  assert.deepStrictEqual(custom, { path: 'x-custom.thing', value: 42 });
});

test('uiEntryToApi writes back the original telemetry verbatim, full precision', () => {
  const ui = apiToUiEntry(apiEntry());
  const api = uiEntryToApi(ui);
  assert.strictEqual(api.id, '1b4e28ba-2fa1-11d2-883f-b9a761bde3fb');
  assert.strictEqual(api.datetime, '2026-06-11T08:00:00.000Z');
  assert.strictEqual(api.text, 'Full snapshot');
  assert.strictEqual(api.origin, 'agent');
  const log = api.telemetry.find((pv) => pv.path === 'navigation.log');
  assert.strictEqual(log.value, 237796.8, 'no precision lost through the UI round trip');
  const custom = api.telemetry.find((pv) => pv.path === 'x-custom.thing');
  assert.ok(custom, 'unknown telemetry paths ride along');
  // Display-only fields (which unit preferences may have overwritten with
  // e.g. km/h) are never converted back into the payload
  assert.strictEqual(api.speed, undefined);
  assert.strictEqual(api.heading, undefined);
  assert.strictEqual(api.course, undefined);
  assert.strictEqual(api.barometer, undefined);
  assert.strictEqual(api.wind, undefined);
});

test('uiEntryToApi rebuilds only the editor-editable pathvalues from the form', () => {
  const ui = apiToUiEntry(apiEntry());
  // The user edited the position and the sea state in the form
  ui.position = { latitude: 61.5, longitude: 26.5, source: 'Visual' };
  ui.observations = {
    ...ui.observations, seaState: 2, cloudCoverage: 6, visibility: 8,
  };
  ui.vhf = '72';
  const api = uiEntryToApi(ui);
  const position = api.telemetry.find((pv) => pv.path === 'navigation.position');
  assert.deepStrictEqual(position.value, { latitude: 61.5, longitude: 26.5, source: 'Visual' });
  const seaState = api.telemetry.find((pv) => pv.path === 'environment.water.seaStateValue');
  assert.strictEqual(seaState.value, 2, 'Douglas 2 reads back as Beaufort 2');
  const seaStateLabel = api.telemetry.find((pv) => pv.path === 'environment.water.seaState');
  assert.strictEqual(seaStateLabel.value, 'smooth', 'Douglas 2 reads back as the state-of-sea label');
  assert.strictEqual(
    api.telemetry.filter((pv) => pv.path === 'environment.water.seaState').length,
    1,
    'the stale label pathvalue from the read is not kept alongside the rebuilt one',
  );
  const cloud = api.telemetry.find((pv) => pv.path === 'environment.outside.cloudCover');
  assert.ok(Math.abs(cloud.value - 0.75) < 1e-9, '6 oktas back as the ratio');
  const visibility = api.telemetry.find((pv) => pv.path === 'environment.outside.visibility');
  assert.strictEqual(visibility.value, 8);
  const vhf = api.telemetry.find((pv) => pv.path === 'communication.vhf.channel');
  assert.strictEqual(vhf.value, '72');
  // And the display-only paths were not duplicated from form fields
  assert.strictEqual(
    api.telemetry.filter((pv) => pv.path === 'navigation.speedOverGround').length,
    1,
  );
});

test('uiEntryToApi drops UI-only fields through the open content model', () => {
  const ui = {
    ...apiToUiEntry(apiEntry()),
    point: { latitude: 60.1, longitude: 25.1 },
    date: new Date('2026-06-11T08:00:00.000Z'),
    ago: 0,
    when: 'specific',
    timeMode: 'specific',
  };
  const api = uiEntryToApi(ui);
  EDITABLE_PATHS.concat(['id', 'datetime', 'text', 'origin', 'category']).forEach(() => {});
  ['point', 'date', 'ago', 'when', 'timeMode', '_telemetry', 'speed', 'heading', 'wind', 'barometer', 'log', 'engine'].forEach((field) => {
    assert.strictEqual(api[field], undefined, `${field} is never persisted`);
  });
});

test('uiEntryToApi round-trips a display-converted entry without unit leakage', () => {
  // Simulate what applyDisplayUnits does: overwrite the display fields
  // with values in the user's preferred units (km/h, mbar)
  const ui = apiToUiEntry(apiEntry());
  ui.speed = { ...ui.speed, sog: 9.6, sogUnit: 'km/h' };
  ui.barometer = 1013;
  ui.barometerUnit = 'mbar';
  ui.heading = 190;
  ui.headingUnit = '°';
  const api = uiEntryToApi(ui);
  const sog = api.telemetry.find((pv) => pv.path === 'navigation.speedOverGround');
  assert.strictEqual(sog.value, 2.6751, 'SI telemetry unaffected by display conversion');
  const pressure = api.telemetry.find((pv) => pv.path === 'environment.outside.pressure');
  assert.strictEqual(pressure.value, 101325, 'display-unit values never leak into writes');
  const heading = api.telemetry.find((pv) => pv.path === 'navigation.headingTrue');
  assert.strictEqual(heading.value, 3.3161);
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
  // Form-captured observations and position become telemetry pathvalues
  const withObservations = draftToApiEntry({
    text: 'Anchored',
    ago: 0,
    position: { latitude: 60.1, longitude: 25.1, source: 'GPS' },
    observations: { seaState: 3, cloudCoverage: 4, visibility: 7 },
  }, now);
  const position = withObservations.telemetry.find((pv) => pv.path === 'navigation.position');
  assert.deepStrictEqual(position.value, { latitude: 60.1, longitude: 25.1, source: 'GPS' });
  const seaState = withObservations.telemetry.find((pv) => pv.path === 'environment.water.seaStateValue');
  assert.strictEqual(seaState.value, 3, 'Douglas 3 reads back as Beaufort 3');
  const cloud = withObservations.telemetry.find((pv) => pv.path === 'environment.outside.cloudCover');
  assert.strictEqual(cloud.value, 0.5);
});
