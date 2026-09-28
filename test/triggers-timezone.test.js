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

test('processTriggers ignores a NULL to value transition', async () => {
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
      'environment.time.timezoneOffset': null,
    },
    log,
    appHarness(),
  );

  assert.strictEqual(appended, false);
});

test('processTriggers ignores a value re-arriving through NULL after restart', async () => {
  // After an SK restart the plugin state is fresh: the previously logged
  // offset arrives once more, possibly through a null in between. None of
  // that is a real timezone change, so nothing should be appended
  let appended = false;
  const log = {
    appendEntry: async () => {
      appended = true;
    },
  };

  // NULL value arriving: not a number, ignored entirely
  await processTriggers(
    'environment.time.timezoneOffset',
    null,
    {
      'navigation.datetime': '2026-07-05T12:00:00.000Z',
      'environment.time.timezoneOffset': 1300,
    },
    log,
    appHarness(),
  );

  // Same offset re-arriving with NULL as the stored previous value
  await processTriggers(
    'environment.time.timezoneOffset',
    1300,
    {
      'navigation.datetime': '2026-07-05T12:00:00.000Z',
      'environment.time.timezoneOffset': null,
    },
    log,
    appHarness(),
  );

  assert.strictEqual(appended, false);
});

test('processTriggers logs again after NULL when the offset really changed', async () => {
  const appended = [];
  const log = {
    appendEntry: async (date, entry) => {
      appended.push({ date, entry });
    },
  };

  await processTriggers(
    'environment.time.timezoneOffset',
    1200,
    {
      'navigation.datetime': '2026-07-05T12:00:00.000Z',
      'environment.time.timezoneOffset': null,
    },
    log,
    appHarness(),
  );
  assert.strictEqual(appended.length, 0);

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
