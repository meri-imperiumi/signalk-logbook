const test = require('node:test');
const assert = require('node:assert');
const { explicitDatetime, newEntryFromBody } = require('../plugin/newEntry');

test('explicitDatetime normalizes valid input to ISO', () => {
  assert.strictEqual(
    explicitDatetime('2026-07-07T18:45:00.000Z'),
    '2026-07-07T18:45:00.000Z',
  );
});

test('explicitDatetime rejects invalid input', () => {
  assert.throws(() => explicitDatetime('not a date'), /Invalid datetime/);
});

test('newEntryFromBody uses state snapshot when datetime is absent', () => {
  const entry = newEntryFromBody(
    {
      text: 'Sailing',
      category: 'navigation',
    },
    {
      'navigation.datetime': '2026-07-07T18:45:00.000Z',
      'navigation.position': {
        latitude: 48.7,
        longitude: -4.4,
      },
      'environment.wind.speedOverGround': 5,
    },
    'admin',
  );

  assert.strictEqual(entry.datetime, '2026-07-07T18:45:00.000Z');
  assert.deepStrictEqual(entry.position, { latitude: 48.7, longitude: -4.4 });
  assert.deepStrictEqual(entry.wind, { speed: 9.7 });
  assert.strictEqual(entry.author, 'admin');
});

test('newEntryFromBody with explicit datetime does not copy state-derived navigation data', () => {
  const entry = newEntryFromBody(
    {
      datetime: '2026-07-07T18:45:00.000Z',
      text: 'Forgotten note',
      category: 'navigation',
    },
    {
      'navigation.position': {
        latitude: 48.7,
        longitude: -4.4,
      },
      'environment.wind.speedOverGround': 5,
    },
    'admin',
  );

  assert.strictEqual(entry.datetime, '2026-07-07T18:45:00.000Z');
  assert.strictEqual(entry.text, 'Forgotten note');
  assert.strictEqual(entry.author, 'admin');
  assert.strictEqual(entry.position, undefined);
  assert.strictEqual(entry.wind, undefined);
});
