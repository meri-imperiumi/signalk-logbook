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
  assert.strictEqual(n.buildConfig({ notificationDebounceMinutes: 0 }).debounceMs, 0);
});

function harness() {
  const entries = [];
  const log = {
    appendEntry: (date, data) => {
      entries.push({ date, data });
      return Promise.resolve();
    },
  };
  const app = { setPluginStatus: () => {}, setPluginError: () => {} };
  const state = { 'navigation.datetime': '2026-06-14T12:00:00.000Z' };
  return {
    entries, log, app, state,
  };
}

test('a raise opens an episode and logs exactly one entry', async () => {
  const {
    entries, log, app, state,
  } = harness();
  const episodes = new Map();
  await n.processNotification(
    'notifications.propulsion.1.temperature',
    { state: 'alarm', message: 'High temperature' },
    state,
    episodes,
    log,
    app,
    n.buildConfig({}),
    1000,
  );
  assert.strictEqual(entries.length, 1);
  assert.strictEqual(entries[0].data.text, 'Alarm: High temperature (propulsion.1.temperature)');
  assert.strictEqual(entries[0].data.category, 'engine');
  assert.strictEqual(episodes.size, 1);
});

test('re-raises and brief clears within an episode add no further entries', async () => {
  const {
    entries, log, app, state,
  } = harness();
  const episodes = new Map();
  const p = 'notifications.tanks.fuel.0.currentLevel';
  const cfg = n.buildConfig({});
  await n.processNotification(p, { state: 'warn', message: 'Low fuel' }, state, episodes, log, app, cfg, 0);
  await n.processNotification(p, { state: 'normal' }, state, episodes, log, app, cfg, 1000);
  await n.processNotification(
    p,
    { state: 'alarm', message: 'Low fuel' },
    state,
    episodes,
    log,
    app,
    cfg,
    2000,
  );
  assert.strictEqual(entries.length, 1);
  const ep = episodes.get(p);
  assert.strictEqual(ep.peakState, 'alarm');
  assert.strictEqual(ep.transitions, 2);
  assert.strictEqual(ep.clearedSince, null);
});

test('a notification below the minimum level opens nothing', async () => {
  const {
    entries, log, app, state,
  } = harness();
  const episodes = new Map();
  await n.processNotification(
    'notifications.x.y',
    { state: 'warn', message: 'm' },
    state,
    episodes,
    log,
    app,
    n.buildConfig({ notificationMinLevel: 'alarm' }),
    0,
  );
  assert.strictEqual(entries.length, 0);
  assert.strictEqual(episodes.size, 0);
});

test('a clear marks clearedSince without logging', async () => {
  const {
    entries, log, app, state,
  } = harness();
  const episodes = new Map();
  const p = 'notifications.propulsion.1.temperature';
  const cfg = n.buildConfig({});
  await n.processNotification(p, { state: 'alarm', message: 'Hot' }, state, episodes, log, app, cfg, 0);
  await n.processNotification(p, null, state, episodes, log, app, cfg, 5000);
  assert.strictEqual(entries.length, 1);
  assert.strictEqual(episodes.get(p).clearedSince, 5000);
});

test('excluded paths and disabled config are ignored', async () => {
  const {
    entries, log, app, state,
  } = harness();
  const episodes = new Map();
  await n.processNotification(
    'notifications.navigation.gnss.methodQuality',
    { state: 'warn', message: 'm' },
    state,
    episodes,
    log,
    app,
    n.buildConfig({ notificationExcludePaths: ['navigation.gnss'] }),
    0,
  );
  await n.processNotification(
    'notifications.propulsion.1.temperature',
    { state: 'alarm', message: 'm' },
    state,
    episodes,
    log,
    app,
    n.buildConfig({ logNotifications: false }),
    0,
  );
  assert.strictEqual(entries.length, 0);
  assert.strictEqual(episodes.size, 0);
});

test('an episode closes only after the debounce window, logging one backdated clear', async () => {
  const {
    entries, log, app, state,
  } = harness();
  const episodes = new Map();
  const p = 'notifications.propulsion.1.temperature';
  const cfg = n.buildConfig({ notificationDebounceMinutes: 5 }); // 300000 ms
  await n.processNotification(p, { state: 'alarm', message: 'High temp' }, state, episodes, log, app, cfg, 0);
  await n.processNotification(p, { state: 'normal' }, state, episodes, log, app, cfg, 60000);

  await n.sweepNotifications(episodes, state, log, app, cfg, 120000); // within window
  assert.strictEqual(entries.length, 1);
  assert.strictEqual(episodes.size, 1);

  await n.sweepNotifications(episodes, state, log, app, cfg, 360000); // 360000 - 60000 >= 300000
  assert.strictEqual(entries.length, 2);
  assert.strictEqual(episodes.size, 0);
  assert.strictEqual(entries[1].data.text, 'Cleared after 1 min: High temp');
  assert.strictEqual(entries[1].data.datetime, new Date(60000).toISOString());
});

test('a re-raise before the window cancels the pending close', async () => {
  const {
    entries, log, app, state,
  } = harness();
  const episodes = new Map();
  const p = 'notifications.propulsion.1.temperature';
  const cfg = n.buildConfig({});
  await n.processNotification(p, { state: 'alarm', message: 'Hot' }, state, episodes, log, app, cfg, 0);
  await n.processNotification(p, { state: 'normal' }, state, episodes, log, app, cfg, 60000);
  await n.processNotification(p, { state: 'alarm', message: 'Hot' }, state, episodes, log, app, cfg, 90000);
  await n.sweepNotifications(episodes, state, log, app, cfg, 600000);
  assert.strictEqual(entries.length, 1);
  assert.strictEqual(episodes.size, 1);
});

test('a flapping notification yields exactly two entries spanning the noise', async () => {
  const {
    entries, log, app, state,
  } = harness();
  const episodes = new Map();
  const p = 'notifications.tanks.bilge.0.level';
  const cfg = n.buildConfig({}); // warn+, 5 min debounce
  await n.processNotification(p, { state: 'warn', message: 'Bilge high' }, state, episodes, log, app, cfg, 0);
  await n.processNotification(p, { state: 'normal' }, state, episodes, log, app, cfg, 1000);
  await n.processNotification(p, { state: 'alarm', message: 'Bilge high' }, state, episodes, log, app, cfg, 2000);
  await n.processNotification(p, { state: 'normal' }, state, episodes, log, app, cfg, 3000);
  await n.processNotification(p, { state: 'warn', message: 'Bilge high' }, state, episodes, log, app, cfg, 4000);
  await n.processNotification(p, { state: 'normal' }, state, episodes, log, app, cfg, 5000);
  await n.sweepNotifications(episodes, state, log, app, cfg, 5000 + 300000);
  assert.strictEqual(entries.length, 2);
  assert.match(entries[1].data.text, /peaked alarm, 3 transitions/);
});

test('logNotificationClears:false closes episodes without a clear entry', async () => {
  const {
    entries, log, app, state,
  } = harness();
  const episodes = new Map();
  const p = 'notifications.propulsion.1.temperature';
  const cfg = n.buildConfig({ logNotificationClears: false });
  await n.processNotification(p, { state: 'alarm', message: 'Hot' }, state, episodes, log, app, cfg, 0);
  await n.processNotification(p, { state: 'normal' }, state, episodes, log, app, cfg, 60000);
  await n.sweepNotifications(episodes, state, log, app, cfg, 60000 + 300000);
  assert.strictEqual(entries.length, 1);
  assert.strictEqual(episodes.size, 0);
});

test('notification entries are stamped origin auto', async () => {
  let captured;
  const log = { appendEntry: async (date, data) => { captured = data; } };
  const app = { setPluginStatus: () => {} };
  const episodes = new Map();
  await n.processNotification(
    'notifications.navigation.restrictedArea.x',
    { state: 'warn', message: 'Test warning' },
    {},
    episodes,
    log,
    app,
    n.buildConfig({}),
    Date.now(),
  );
  assert.strictEqual(captured.origin, 'auto');
  assert.strictEqual(captured.author, '');
});
