const test = require('node:test');
const assert = require('node:assert');
const { processTriggers, watchLabel } = require('../plugin/triggers');

function appHarness() {
  return {
    setPluginStatus: () => {},
  };
}

test('watchLabel extracts a stable readable name from watch.current values', () => {
  assert.strictEqual(watchLabel('JL'), 'JL');
  assert.strictEqual(watchLabel({ teamName: 'JL', startTime: 1, endTime: 2 }), 'JL');
  assert.strictEqual(watchLabel({ name: 'Port watch' }), 'Port watch');
  assert.strictEqual(watchLabel({ label: 'Graveyard Shift' }), 'Graveyard Shift');
  assert.strictEqual(watchLabel(null), '');
});

test('processTriggers logs object watch.current with the team name', async () => {
  const appended = [];
  const log = {
    appendEntry: async (date, entry) => {
      appended.push({ date, entry });
    },
  };

  await processTriggers(
    'watch.current',
    { teamName: 'JL', startTime: 1, endTime: 2 },
    {
      'navigation.datetime': '2026-07-05T12:00:00.000Z',
      'navigation.state': 'sailing',
    },
    log,
    appHarness(),
  );

  assert.strictEqual(appended.length, 1);
  assert.strictEqual(appended[0].entry.text, 'JL on watch');
});

test('processTriggers ignores object watch.current republished for the same team', async () => {
  let appended = false;
  const log = {
    appendEntry: async () => {
      appended = true;
    },
  };

  await processTriggers(
    'watch.current',
    { teamName: 'JL', startTime: 30, endTime: 40 },
    {
      'navigation.datetime': '2026-07-05T12:00:00.000Z',
      'navigation.state': 'sailing',
      'watch.current': { teamName: 'JL', startTime: 10, endTime: 20 },
    },
    log,
    appHarness(),
  );

  assert.strictEqual(appended, false);
});
