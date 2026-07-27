const test = require('node:test');
const assert = require('node:assert');
const { processTriggers } = require('../plugin/triggers');

function appHarness() {
  const statuses = [];
  return {
    statuses,
    app: {
      setPluginStatus: (status) => statuses.push(status),
      readPluginOptions: () => ({ configuration: {} }),
    },
  };
}

function logHarness() {
  const appended = [];
  return {
    appended,
    log: {
      appendEntry: async (date, entry) => {
        appended.push({ date, entry });
      },
    },
  };
}

test('processTriggers logs an entry when the vessel becomes moored', async () => {
  const { appended, log } = logHarness();
  const { app } = appHarness();

  await processTriggers(
    'navigation.state',
    'moored',
    { 'navigation.state': 'motoring' },
    log,
    app,
  );

  assert.strictEqual(appended.length, 1, 'becoming moored should produce a log entry');
  assert.strictEqual(appended[0].entry.text, 'Stopped');
  assert.strictEqual(appended[0].entry.end, true);
});

test('processTriggers logs an entry when the vessel becomes anchored', async () => {
  const { appended, log } = logHarness();
  const { app } = appHarness();

  await processTriggers(
    'navigation.state',
    'anchored',
    { 'navigation.state': 'motoring' },
    log,
    app,
  );

  assert.strictEqual(appended.length, 1);
  assert.strictEqual(appended[0].entry.text, 'Anchored');
  assert.strictEqual(appended[0].entry.end, true);
});

test('processTriggers resets the heading buffer when the vessel stops', async () => {
  const { log } = logHarness();
  const { app } = appHarness();
  const oldState = {
    'navigation.state': 'motoring',
    'custom.headingBuffer': [10, 20, 30],
    'custom.lastLoggedHeading': 20,
  };
  const expected = { 'custom.headingBuffer': [], 'custom.lastLoggedHeading': null };

  const mooredUpdates = await processTriggers('navigation.state', 'moored', oldState, log, app);
  assert.deepStrictEqual(mooredUpdates, expected, 'moored should reset the heading buffer');

  const anchoredUpdates = await processTriggers('navigation.state', 'anchored', oldState, log, app);
  assert.deepStrictEqual(anchoredUpdates, expected, 'anchored should reset the heading buffer');
});
