const test = require('node:test');
const assert = require('node:assert');
const {
  offsetToZone,
  displayZone,
  formatTimestamp,
  zoneLabel,
} = require('../src/helpers/timezone');

test('offsetToZone formats (-)hhmm encoding as zero-padded fixed offsets', () => {
  assert.strictEqual(offsetToZone(1300), 'UTC+13:00');
  assert.strictEqual(offsetToZone(330), 'UTC+03:30');
  assert.strictEqual(offsetToZone(-930), 'UTC-09:30');
  assert.strictEqual(offsetToZone(200), 'UTC+02:00');
  assert.strictEqual(offsetToZone(0), 'UTC+00:00');
});

test('offsetToZone rejects values outside the Signal K (-)hhmm contract', () => {
  assert.strictEqual(offsetToZone(undefined), null);
  assert.strictEqual(offsetToZone(Number.NaN), null);
  assert.strictEqual(offsetToZone(330.5), null);
  assert.strictEqual(offsetToZone(1360), null);
  assert.strictEqual(offsetToZone(1400), null);
  assert.strictEqual(offsetToZone(-14400), null);
});

test('displayZone resolves ship time from the timezone offset', () => {
  assert.strictEqual(displayZone('ship', 1300), 'UTC+13:00');
  assert.strictEqual(displayZone('ship', -930), 'UTC-09:30');
  assert.strictEqual(displayZone('ship', 0), 'UTC+00:00');
});

test('displayZone falls back to UTC when ship time has no offset yet', () => {
  assert.strictEqual(displayZone('ship', null), 'UTC');
  assert.strictEqual(displayZone('ship', undefined), 'UTC');
  assert.strictEqual(displayZone('ship', -14400), 'UTC');
});

test('displayZone falls back to UTC for unknown settings', () => {
  assert.strictEqual(displayZone('UTC', 1300), 'UTC');
  assert.strictEqual(displayZone('Europe/Helsinki', 0), 'UTC');
  assert.strictEqual(displayZone(undefined, 1300), 'UTC');
});

test('formatTimestamp renders UTC with an explicit Z suffix', () => {
  assert.strictEqual(
    formatTimestamp(new Date('2026-09-28T14:30:05.000Z'), 'UTC'),
    '2026-09-28 14:30:05Z',
  );
});

test('formatTimestamp renders ship time without a timezone specifier', () => {
  assert.strictEqual(
    formatTimestamp(new Date('2026-09-28T14:30:05.000Z'), 'UTC+13:00'),
    '2026-09-29 03:30:05',
  );
  assert.strictEqual(
    formatTimestamp(new Date('2026-09-28T14:30:05.000Z'), 'UTC-09:30'),
    '2026-09-28 05:00:05',
  );
});

test('zoneLabel renders UTC', () => {
  assert.strictEqual(zoneLabel('UTC'), 'UTC');
  assert.strictEqual(zoneLabel(undefined), 'UTC');
});

test('zoneLabel renders ship time offsets', () => {
  assert.strictEqual(zoneLabel('UTC+13:00'), 'UTC+13');
  assert.strictEqual(zoneLabel('UTC-09:30'), 'UTC-9:30');
  assert.strictEqual(zoneLabel('UTC+03:30'), 'UTC+3:30');
  assert.strictEqual(zoneLabel('UTC+00:00'), 'UTC+0');
});
