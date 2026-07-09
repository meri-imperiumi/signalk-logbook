const test = require('node:test');
const assert = require('node:assert');
const { processTriggers } = require('../plugin/triggers');

function appHarness() {
  return {
    setPluginStatus: () => {},
  };
}

test('processTriggers ignores unchanged crew lists', async () => {
  let appended = false;
  const log = {
    appendEntry: async () => {
      appended = true;
    },
  };

  await processTriggers(
    'communication.crewNames',
    ['Alice', 'Bob'],
    {
      'navigation.datetime': '2026-07-05T12:00:00.000Z',
      'communication.crewNames': ['Alice', 'Bob'],
    },
    log,
    appHarness(),
  );

  assert.strictEqual(appended, false);
});

test('processTriggers logs added crew member', async () => {
  const appended = [];
  const log = {
    appendEntry: async (date, entry) => {
      appended.push({ date, entry });
    },
  };

  await processTriggers(
    'communication.crewNames',
    ['Alice', 'Bob'],
    {
      'navigation.datetime': '2026-07-05T12:00:00.000Z',
      'communication.crewNames': ['Alice'],
    },
    log,
    appHarness(),
  );

  assert.strictEqual(appended.length, 1);
  assert.strictEqual(appended[0].entry.text, 'Bob joined the crew');
});
