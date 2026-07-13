const test = require('node:test');
const assert = require('node:assert');
const stateToEntry = require('../plugin/format');

test('waypoint copies only latitude and longitude', () => {
  const state = {
    'navigation.course.nextPoint': {
      position: {
        latitude: 48.7, longitude: -123.1, altitude: 0, foo: 'bar',
      },
    },
  };

  const entry = stateToEntry(state, 'Test entry');

  assert.deepStrictEqual(entry.waypoint, { latitude: 48.7, longitude: -123.1 });
});

test('single engine populates engine.hours and engine.engines', () => {
  const state = { 'propulsion.main.runTime': 44280 }; // 12.3h

  const entry = stateToEntry(state, 'Underway');

  assert.strictEqual(entry.engine.hours, 12.3);
  assert.deepStrictEqual(entry.engine.engines, { main: { hours: 12.3 } });
});

test('twin engine populates engine.engines without setting engine.hours', () => {
  const state = {
    'propulsion.port.runTime': 44280, // 12.3h
    'propulsion.starboard.runTime': 43560, // 12.1h
  };

  const entry = stateToEntry(state, 'Underway');

  assert.strictEqual(entry.engine.hours, undefined);
  assert.deepStrictEqual(entry.engine.engines, {
    port: { hours: 12.3 },
    starboard: { hours: 12.1 },
  });
});

test('pre-existing entry with only engine.hours loads without error', () => {
  const oldEntry = { engine: { hours: 10.5 } };

  assert.strictEqual(oldEntry.engine.hours, 10.5);
  assert.strictEqual(oldEntry.engine.engines, undefined);
});

test('stateToEntry stamps origin manual by default and accepts an override', () => {
  assert.strictEqual(stateToEntry({}, 'hello').origin, 'manual');
  assert.strictEqual(stateToEntry({}, 'hello', '', 'auto').origin, 'auto');
  assert.strictEqual(stateToEntry({}, 'hello', 'poseidon', 'agent').origin, 'agent');
});

test('skipperName is snapshotted into the entry', () => {
  const state = { 'communication.skipperName': 'Alice' };

  const entry = stateToEntry(state, 'Test entry');

  assert.strictEqual(entry.skipperName, 'Alice');
});

test('entry has no skipperName key when state lacks one', () => {
  const entry = stateToEntry({}, 'Test entry');

  assert.strictEqual('skipperName' in entry, false);
});
