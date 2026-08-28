const test = require('node:test');
const assert = require('node:assert');
const { entryMarkerColor } = require('../src/helpers/markers');

// Marker colors must stay in sync between the raster (pigeon-maps) and
// vector (MapLibre) renderers of the log map
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
