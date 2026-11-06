const test = require('node:test');
const assert = require('node:assert');
const {
  unwrapLongitude,
  unwrapTrackPoints,
} = require('../src/helpers/geo');

test('unwrapTrackPoints keeps an ordinary track unchanged', () => {
  const points = [
    { lat: 60.1, lon: 24.9 },
    { lat: 60.2, lon: 25.1 },
    { lat: 60.3, lon: 25.4 },
  ];
  assert.deepStrictEqual(unwrapTrackPoints(points), points);
});

test('unwrapTrackPoints continues eastbound across the antimeridian', () => {
  const points = unwrapTrackPoints([
    { lat: -17.0, lon: 179.5 },
    { lat: -17.1, lon: -179.5 },
    { lat: -17.2, lon: -179.0 },
  ]);
  assert.deepStrictEqual(points, [
    { lat: -17.0, lon: 179.5 },
    { lat: -17.1, lon: 180.5 },
    { lat: -17.2, lon: 181.0 },
  ]);
});

test('unwrapTrackPoints continues westbound across the antimeridian', () => {
  const points = unwrapTrackPoints([
    { lat: -17.0, lon: -179.5 },
    { lat: -17.1, lon: 179.5 },
    { lat: -17.2, lon: 179.0 },
  ]);
  assert.deepStrictEqual(points, [
    { lat: -17.0, lon: -179.5 },
    { lat: -17.1, lon: -180.5 },
    { lat: -17.2, lon: -181.0 },
  ]);
});

test('unwrapTrackPoints follows a track around the planet', () => {
  const points = unwrapTrackPoints([
    { lat: 0, lon: 170 },
    { lat: 0, lon: -170 },
    { lat: 0, lon: -150 },
    { lat: 0, lon: -170 },
    { lat: 0, lon: 170 },
  ]);
  assert.deepStrictEqual(points, [
    { lat: 0, lon: 170 },
    { lat: 0, lon: 190 },
    { lat: 0, lon: 210 },
    { lat: 0, lon: 190 },
    { lat: 0, lon: 170 },
  ]);
});

test('unwrapTrackPoints leaves broken longitudes untouched without derailing successors', () => {
  const points = unwrapTrackPoints([
    { lat: -17.0, lon: 179.5 },
    { lat: -17.1, lon: Number.NaN },
    { lat: -17.2, lon: -179.5 },
  ]);
  assert.strictEqual(points[0].lon, 179.5);
  assert.strictEqual(points[1].lon, Number.NaN);
  // Unwrapping resumes from the last good value, not the broken one
  assert.strictEqual(points[2].lon, 180.5);
});

test('unwrapLongitude shifts onto the world copy nearest the reference', () => {
  assert.strictEqual(unwrapLongitude(-179.7, 179.9), 180.3);
  assert.strictEqual(unwrapLongitude(179.7, -179.9), -180.3);
  assert.strictEqual(unwrapLongitude(25.1, 25.3), 25.1);
});
