const test = require('node:test');
const assert = require('node:assert');
const stateToEntry = require('../plugin/format');

test('single engine populates engine.hours and engine.engines', () => {
  const state = { 'propulsion.main.runTime': 44280 }; // 12.3h

  const entry = stateToEntry(state, 'Underway');

  assert.strictEqual(entry.engine.hours, 12.3);
  assert.deepStrictEqual(entry.engine.engines, { main: { hours: 12.3 } });
});

test('twin engine populates engine.engines without setting engine.hours', () => {
  const state = {
    'propulsion.port.runTime': 44280,      // 12.3h
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
