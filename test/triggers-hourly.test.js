const test = require('node:test');
const assert = require('node:assert');
const { processHourly } = require('../plugin/triggers');

function appHarness() {
  const statuses = [];
  return {
    statuses,
    app: {
      setPluginStatus: (status) => statuses.push(status),
    },
  };
}

test('processHourly skips when an entry already exists inside the hourly window', async () => {
  const entries = [
    {
      datetime: new Date('2026-07-05T12:00:30.000Z'),
      text: 'Manual entry',
    },
  ];
  let appended = false;
  const log = {
    getDate: async () => entries,
    appendEntry: async () => {
      appended = true;
    },
  };
  const { app, statuses } = appHarness();

  await processHourly({
    'navigation.state': 'sailing',
    'navigation.datetime': '2026-07-05T12:01:00.000Z',
  }, log, app, 1);

  assert.strictEqual(appended, false);
  assert.deepStrictEqual(statuses, ['Skipped automatic hourly log entry an entry exists already']);
});

test('processHourly writes when existing entries are outside the hourly window', async () => {
  const entries = [
    {
      datetime: new Date('2026-07-05T11:58:30.000Z'),
      text: 'Older entry',
    },
  ];
  const appended = [];
  const log = {
    getDate: async () => entries,
    appendEntry: async (date, entry) => {
      appended.push({ date, entry });
    },
  };
  const { app } = appHarness();

  await processHourly({
    'navigation.state': 'sailing',
    'navigation.datetime': '2026-07-05T12:01:00.000Z',
  }, log, app, 1);

  assert.strictEqual(appended.length, 1);
  assert.strictEqual(appended[0].date, '2026-07-05');
});
