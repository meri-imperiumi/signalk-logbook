const test = require('node:test');
const assert = require('node:assert');
const { processTriggers } = require('../plugin/triggers');

function appHarness(options = {}) {
  const opts = { ...options };
  if (opts.logHeadingChanges === undefined) {
    opts.logHeadingChanges = true;
  }
  const statuses = [];
  return {
    statuses,
    app: {
      setPluginStatus: (status) => statuses.push(status),
      readPluginOptions: () => ({ configuration: opts }),
    },
  };
}

test('processTriggers logs heading change when motoring even if wind side changes', async () => {
  const appended = [];
  const log = {
    appendEntry: async (date, entry) => {
      appended.push({ date, entry });
    },
  };
  const { app } = appHarness();

  let state = {
    'navigation.state': 'motoring',
    'navigation.headingTrue': 0,
    'environment.wind.directionTrue': 140,
  };

  // Fill buffer and set lastLoggedHeading to 0
  for (let i = 0; i < 10; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const updates = await processTriggers('navigation.headingTrue', 0, state, log, app);
    state = { ...state, ...updates, 'navigation.headingTrue': 0 };
  }

  // Change heading to 90.
  // Wind 140, H_old 0 -> R_old = 140 (Starboard)
  // Wind 140, H_new 90 -> R_new = 50 (Starboard)
  // Side did not change.
  // BUT because we are motoring, it should NOT be a Tack.
  for (let i = 0; i < 15; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const updates = await processTriggers('navigation.headingTrue', 90, state, log, app);
    state = { ...state, ...updates, 'navigation.headingTrue': 90 };
  }

  const tackEntries = appended.filter((e) => e.entry.text.includes('Tack'));
  const gybeEntries = appended.filter((e) => e.entry.text.includes('Gybe'));
  assert.strictEqual(tackEntries.length, 0, 'Should not log a Tack when motoring');
  assert.strictEqual(gybeEntries.length, 0, 'Should not log a Gybe when motoring');

  const headingEntries = appended.filter((e) => e.entry.text.includes('Heading changed to'));
  assert.strictEqual(headingEntries.length, 1, 'Should log a heading change when motoring');
  assert.ok(headingEntries[0].entry.text.includes('Heading changed to'), `Expected text to include 'Heading changed to', but got '${headingEntries[0].entry.text}'`);
});

test('processTriggers still logs tack when sailing and wind side changes', async () => {
  const appended = [];
  const log = {
    appendEntry: async (date, entry) => {
      appended.push({ date, entry });
    },
  };
  const { app } = appHarness();

  let state = {
    'navigation.state': 'sailing',
    'navigation.headingTrue': 0,
    'environment.wind.directionTrue': 140,
  };

  // Fill buffer and set lastLoggedHeading to 0
  for (let i = 0; i < 10; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const updates = await processTriggers('navigation.headingTrue', 0, state, log, app);
    state = { ...state, ...updates, 'navigation.headingTrue': 0 };
  }

  // Change heading to 180.
  // Wind 140, H_old 0 -> R_old = 140 (Starboard)
  // Wind 140, H_new 180 -> R_new = 320 (Port)
  // Side changed from Starboard to Port. DeltaR = -80 (Tack).
  for (let i = 0; i < 15; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const updates = await processTriggers('navigation.headingTrue', 180, state, log, app);
    state = { ...state, ...updates, 'navigation.headingTrue': 180 };
  }

  const tackEntries = appended.filter((e) => e.entry.text.includes('Tack'));
  assert.strictEqual(tackEntries.length, 1, 'Should log a Tack when sailing');
  assert.ok(tackEntries[0].entry.text.includes('Tack (Heading 180°)'));
});
