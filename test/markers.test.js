const test = require('node:test');
const assert = require('node:assert');
const { entryMarkerColor } = require('../src/helpers/markers');

// Marker colors are used by the log map's entry markers (ChartMap) and
// wherever entries are listed in the UI
test('entryMarkerColor colors engine entries red', () => {
  assert.strictEqual(entryMarkerColor('engine'), '#ed1b2f');
});

test('entryMarkerColor colors radio entries teal', () => {
  assert.strictEqual(entryMarkerColor('radio'), '#00ae9d');
});

test('entryMarkerColor defaults to blue for other categories', () => {
  assert.strictEqual(entryMarkerColor(undefined), '#009bdb');
  assert.strictEqual(entryMarkerColor('navigation'), '#009bdb');
});
