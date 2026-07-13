const test = require('node:test');
const assert = require('node:assert');
const { processTriggers } = require('../plugin/triggers');

function appHarness() {
  return {
    setPluginStatus: () => {},
  };
}

test('processTriggers logs a skipper change', async () => {
  const appended = [];
  const log = {
    appendEntry: async (date, entry) => {
      appended.push({ date, entry });
    },
  };

  await processTriggers(
    'communication.skipperName',
    'Bob',
    {
      'navigation.datetime': '2026-07-05T12:00:00.000Z',
      'communication.skipperName': 'Alice',
    },
    log,
    appHarness(),
  );

  assert.strictEqual(appended.length, 1);
  assert.strictEqual(appended[0].entry.text, 'Bob took over as skipper');
});

test('processTriggers ignores unchanged skipper', async () => {
  let appended = false;
  const log = {
    appendEntry: async () => {
      appended = true;
    },
  };

  await processTriggers(
    'communication.skipperName',
    'Alice',
    {
      'navigation.datetime': '2026-07-05T12:00:00.000Z',
      'communication.skipperName': 'Alice',
    },
    log,
    appHarness(),
  );

  assert.strictEqual(appended, false);
});

test('processTriggers ignores initial skipper value', async () => {
  let appended = false;
  const log = {
    appendEntry: async () => {
      appended = true;
    },
  };

  await processTriggers(
    'communication.skipperName',
    'Alice',
    {
      'navigation.datetime': '2026-07-05T12:00:00.000Z',
    },
    log,
    appHarness(),
  );

  assert.strictEqual(appended, false);
});

test('processTriggers ignores skipper being cleared', async () => {
  let appended = false;
  const log = {
    appendEntry: async () => {
      appended = true;
    },
  };

  await processTriggers(
    'communication.skipperName',
    null,
    {
      'navigation.datetime': '2026-07-05T12:00:00.000Z',
      'communication.skipperName': 'Alice',
    },
    log,
    appHarness(),
  );

  assert.strictEqual(appended, false);
});
