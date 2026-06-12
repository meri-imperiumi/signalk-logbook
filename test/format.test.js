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
