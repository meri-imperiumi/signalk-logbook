const test = require('node:test');
const assert = require('node:assert');
const n = require('../plugin/notifications');

test('levelRank orders notification states; unknown/normal is 0', () => {
  assert.strictEqual(n.levelRank('normal'), 0);
  assert.strictEqual(n.levelRank('warn'), 2);
  assert.strictEqual(n.levelRank('emergency'), 4);
  assert.strictEqual(n.levelRank(undefined), 0);
});

test('categoryForPath maps known prefixes, defaults to navigation', () => {
  assert.strictEqual(n.categoryForPath('propulsion.1.temperature'), 'engine');
  assert.strictEqual(n.categoryForPath('electrical.batteries.0.voltage'), 'engine');
  assert.strictEqual(n.categoryForPath('communication.vhf'), 'radio');
  assert.strictEqual(n.categoryForPath('environment.wind.speedTrue'), 'navigation');
});

test('isExcluded matches an exact path or a prefix segment', () => {
  assert.strictEqual(n.isExcluded('navigation.gnss.methodQuality', ['navigation.gnss']), true);
  assert.strictEqual(n.isExcluded('navigation.gnss', ['navigation.gnss']), true);
  assert.strictEqual(n.isExcluded('navigation.gnssX', ['navigation.gnss']), false);
  assert.strictEqual(n.isExcluded('propulsion.1.temperature', []), false);
});

test('humanDuration renders seconds, minutes, and hours', () => {
  assert.strictEqual(n.humanDuration(45000), '45 s');
  assert.strictEqual(n.humanDuration(60000), '1 min');
  assert.strictEqual(n.humanDuration(14 * 60000), '14 min');
  assert.strictEqual(n.humanDuration(3 * 3600000 + 5 * 60000), '3 h 5 min');
});

test('formatRaise uses the message, or falls back to the path', () => {
  assert.strictEqual(
    n.formatRaise({ state: 'alarm', message: 'High temperature' }, 'propulsion.1.temperature'),
    'Alarm: High temperature (propulsion.1.temperature)',
  );
  assert.strictEqual(
    n.formatRaise({ state: 'warn' }, 'tanks.fuel.0.currentLevel'),
    'Warn notification: tanks.fuel.0.currentLevel',
  );
});

test('formatClear reports duration, and peak/transitions only when relevant', () => {
  const simple = n.formatClear({
    startTime: 0,
    clearedSince: 60000,
    openState: 'alarm',
    peakState: 'alarm',
    message: 'High temperature',
    transitions: 1,
  }, 'propulsion.1.temperature');
  assert.strictEqual(simple, 'Cleared after 1 min: High temperature');

  const noisy = n.formatClear({
    startTime: 0,
    clearedSince: 14 * 60000,
    openState: 'warn',
    peakState: 'alarm',
    message: 'Low fuel',
    transitions: 9,
  }, 'tanks.fuel.0.currentLevel');
  assert.strictEqual(noisy, 'Cleared after 14 min: Low fuel — peaked alarm, 9 transitions');
});

test('buildConfig applies defaults and reads overrides', () => {
  assert.deepStrictEqual(n.buildConfig({}), {
    enabled: true,
    minLevel: 'warn',
    debounceMs: 300000,
    excludePaths: [],
    logClears: true,
  });
  assert.deepStrictEqual(n.buildConfig({
    logNotifications: false,
    notificationMinLevel: 'alarm',
    notificationDebounceMinutes: 2,
    notificationExcludePaths: ['navigation.gnss'],
    logNotificationClears: false,
  }), {
    enabled: false,
    minLevel: 'alarm',
    debounceMs: 120000,
    excludePaths: ['navigation.gnss'],
    logClears: false,
  });
});
