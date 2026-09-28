const test = require('node:test');
const assert = require('node:assert');
const { processTriggers } = require('../plugin/triggers');

function appHarness() {
  return {
    setPluginStatus: () => {},
  };
}

test('processTriggers logs ship time change to whole-hour offset', async () => {
  const appended = [];
  const log = {
    appendEntry: async (date, entry) => {
      appended.push({ date, entry });
    },
  };

  await processTriggers(
    'environment.time.timezoneOffset',
    1300,
    {
      'navigation.datetime': '2026-07-05T12:00:00.000Z',
      'environment.time.timezoneOffset': 1200,
    },
    log,
    appHarness(),
  );

  assert.strictEqual(appended.length, 1);
  assert.strictEqual(appended[0].entry.text, "Changed ship's time to UTC+13");
  assert.strictEqual(appended[0].entry.category, 'navigation');
});

test('processTriggers logs negative half-hour offset', async () => {
  const appended = [];
  const log = {
    appendEntry: async (date, entry) => {
      appended.push({ date, entry });
    },
  };

  await processTriggers(
    'environment.time.timezoneOffset',
    -930,
    {
      'navigation.datetime': '2026-07-05T12:00:00.000Z',
      'environment.time.timezoneOffset': -1000,
    },
    log,
    appHarness(),
  );

  assert.strictEqual(appended.length, 1);
  assert.strictEqual(appended[0].entry.text, "Changed ship's time to UTC-9:30");
});

test('processTriggers logs change to UTC with zero offset', async () => {
  const appended = [];
  const log = {
    appendEntry: async (date, entry) => {
      appended.push({ date, entry });
    },
  };

  await processTriggers(
    'environment.time.timezoneOffset',
    0,
    {
      'navigation.datetime': '2026-07-05T12:00:00.000Z',
      'environment.time.timezoneOffset': 330,
    },
    log,
    appHarness(),
  );

  assert.strictEqual(appended.length, 1);
  assert.strictEqual(appended[0].entry.text, "Changed ship's time to UTC+0");
});

test('processTriggers ignores unchanged timezone offset', async () => {
  let appended = false;
  const log = {
    appendEntry: async () => {
      appended = true;
    },
  };

  await processTriggers(
    'environment.time.timezoneOffset',
    1300,
    {
      'navigation.datetime': '2026-07-05T12:00:00.000Z',
      'environment.time.timezoneOffset': 1300,
    },
    log,
    appHarness(),
  );

  assert.strictEqual(appended, false);
});

test('processTriggers ignores the first received timezone offset', async () => {
  let appended = false;
  const log = {
    appendEntry: async () => {
      appended = true;
    },
  };

  await processTriggers(
    'environment.time.timezoneOffset',
    1300,
    {
      'navigation.datetime': '2026-07-05T12:00:00.000Z',
    },
    log,
    appHarness(),
  );

  assert.strictEqual(appended, false);
});
