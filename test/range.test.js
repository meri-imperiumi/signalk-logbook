const test = require('node:test');
const assert = require('node:assert');
const {
  QUICK_RANGES,
  DEFAULT_FILTER,
  isCustomFilter,
  isNewStyleFilter,
  normalizeFilter,
  filterLabel,
  filterWindow,
} = require('../src/helpers/range');

test('quick ranges cover the VRM-style presets', () => {
  assert.deepStrictEqual(QUICK_RANGES.map((r) => r.key), [
    '2d', '7d', '30d', '90d', '6m',
  ]);
});

test('default filter is the 7 day quick range', () => {
  assert.deepStrictEqual(DEFAULT_FILTER, { preset: '7d' });
});

test('normalizeFilter passes presets through', () => {
  assert.deepStrictEqual(normalizeFilter({ preset: '90d' }), { preset: '90d' });
  assert.deepStrictEqual(normalizeFilter('6m'), { preset: '6m' });
});

test('normalizeFilter keeps custom ranges', () => {
  assert.deepStrictEqual(
    normalizeFilter({ from: '2026-04-01', to: '2026-04-20' }),
    { from: '2026-04-01', to: '2026-04-20' },
  );
});

test('isNewStyleFilter recognizes the persisted new-style shapes', () => {
  assert.strictEqual(isNewStyleFilter({ preset: '7d' }), true);
  assert.strictEqual(isNewStyleFilter({ preset: '6m' }), true);
  assert.strictEqual(isNewStyleFilter({ from: '2026-04-01', to: '2026-04-20' }), true);
});

test('isNewStyleFilter rejects legacy and junk filters', () => {
  assert.strictEqual(isNewStyleFilter({ daysToShow: 7 }), false);
  assert.strictEqual(isNewStyleFilter({ days: '7' }), false);
  assert.strictEqual(isNewStyleFilter(7), false);
  assert.strictEqual(isNewStyleFilter('7d'), false);
  assert.strictEqual(isNewStyleFilter({ preset: 'nope' }), false);
  assert.strictEqual(isNewStyleFilter({ from: '2026-04-01' }), false);
  assert.strictEqual(isNewStyleFilter({}), false);
  assert.strictEqual(isNewStyleFilter(null), false);
});

test('normalizeFilter maps legacy daysToShow onto a quick range', () => {
  assert.deepStrictEqual(normalizeFilter({ daysToShow: 2 }), { preset: '2d' });
  assert.deepStrictEqual(normalizeFilter({ daysToShow: 7 }), { preset: '7d' });
  assert.deepStrictEqual(normalizeFilter({ daysToShow: 14 }), { preset: '30d' });
  assert.deepStrictEqual(normalizeFilter({ daysToShow: 90 }), { preset: '90d' });
  assert.deepStrictEqual(normalizeFilter({ daysToShow: 183 }), { preset: '6m' });
});

test('normalizeFilter coerces legacy day counts arriving as strings', () => {
  // The old editor kept whatever the applicationData API returned, so
  // the stored count was not guaranteed to be numeric
  assert.deepStrictEqual(normalizeFilter({ daysToShow: '20' }), { preset: '30d' });
  assert.deepStrictEqual(normalizeFilter({ days: '7' }), { preset: '7d' });
  assert.deepStrictEqual(normalizeFilter('20'), { preset: '30d' });
  assert.deepStrictEqual(normalizeFilter(20), { preset: '30d' });
});

test('normalizeFilter falls back to the default on junk', () => {
  assert.deepStrictEqual(normalizeFilter(null), DEFAULT_FILTER);
  assert.deepStrictEqual(normalizeFilter({}), DEFAULT_FILTER);
  assert.deepStrictEqual(normalizeFilter({ preset: 'nope' }), DEFAULT_FILTER);
});

test('isCustomFilter distinguishes the two shapes', () => {
  assert.strictEqual(isCustomFilter({ preset: '7d' }), false);
  assert.strictEqual(isCustomFilter({ from: '2026-04-01', to: '2026-04-20' }), true);
  assert.strictEqual(isCustomFilter({ from: '2026-04-01' }), false);
});

test('filterLabel renders preset labels', () => {
  assert.strictEqual(filterLabel({ preset: '2d' }), 'Last 2 days');
  assert.strictEqual(filterLabel({ preset: '6m' }), 'Last 6 months');
  assert.strictEqual(filterLabel({}), 'Last 7 days');
});

test('filterLabel renders custom ranges as a date span', () => {
  assert.strictEqual(
    filterLabel({ from: '2026-04-01', to: '2026-04-20' }),
    '2026-04-01 – 2026-04-20',
  );
});

test('filterWindow bounds quick ranges to local days', () => {
  // 2026-09-28 10:00Z is already 2026-09-28 23:00 in UTC+13, so the
  // last 2 days start at local midnight of 2026-09-27 (UTC 2026-09-26
  // 11:00) and run to the end of the local day
  const window = filterWindow({ preset: '2d' }, new Date('2026-09-28T10:00:00.000Z'), '+13:00');
  assert.strictEqual(window.from, '2026-09-26T11:00:00.000Z');
  assert.strictEqual(window.to, '2026-09-28T10:59:59.999Z');
});

test('filterWindow bounds the 7 day preset to a week of local days', () => {
  const window = filterWindow({ preset: '7d' }, new Date('2026-09-28T10:00:00.000Z'), 'UTC');
  assert.strictEqual(window.from, '2026-09-22T00:00:00.000Z');
  assert.strictEqual(window.to, '2026-09-28T23:59:59.999Z');
});

test('filterWindow bounds the 6 month preset by calendar months', () => {
  const window = filterWindow({ preset: '6m' }, new Date('2026-09-28T10:00:00.000Z'), 'UTC');
  assert.strictEqual(window.from, '2026-03-28T00:00:00.000Z');
  assert.strictEqual(window.to, '2026-09-28T23:59:59.999Z');
});

test('filterWindow bounds custom ranges to whole local days', () => {
  const window = filterWindow(
    { from: '2026-04-01', to: '2026-04-03' },
    new Date('2026-09-28T10:00:00.000Z'),
    '+05:30',
  );
  // Local midnight of 2026-04-01 is 2026-03-31 18:30Z; end of
  // 2026-04-03 is 2026-04-03 18:29:59.999Z
  assert.strictEqual(window.from, '2026-03-31T18:30:00.000Z');
  assert.strictEqual(window.to, '2026-04-03T18:29:59.999Z');
});

test('filterWindow falls back to the default window on invalid custom dates', () => {
  const now = new Date('2026-09-28T10:00:00.000Z');
  assert.deepStrictEqual(
    filterWindow({ from: 'not-a-date', to: '2026-04-03' }, now, 'UTC'),
    filterWindow(DEFAULT_FILTER, now, 'UTC'),
  );
  assert.deepStrictEqual(
    filterWindow({ from: '2026-04-20', to: '2026-04-01' }, now, 'UTC'),
    filterWindow(DEFAULT_FILTER, now, 'UTC'),
  );
});
