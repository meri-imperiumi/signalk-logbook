const test = require('node:test');
const assert = require('node:assert');
const { processTriggers } = require('../plugin/triggers');

function appHarness(options = {}) {
  const statuses = [];
  return {
    statuses,
    app: {
      setPluginStatus: (status) => statuses.push(status),
      readPluginOptions: () => ({ configuration: options }),
    },
  };
}

test('processTriggers ignores heading changes when not under way', async () => {
  let appended = false;
  const log = {
    appendEntry: async () => {
      appended = true;
    },
  };
  const { app } = appHarness();

  // Initially not under way
  const oldState = {
    'navigation.state': 'anchored',
    'navigation.headingTrue': 0,
  };

  await processTriggers(
    'navigation.headingTrue',
    90,
    oldState,
    log,
    app,
  );

  assert.strictEqual(appended, false);
});

test('processTriggers logs major heading change after stability', async () => {
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
  };

  // Send initial headings to fill buffer and set lastLoggedHeading
  for (let i = 0; i < 10; i++) {
    const updates = await processTriggers(
      'navigation.headingTrue',
      0,
      state,
      log,
      app,
    );
    state = { ...state, ...updates, 'navigation.headingTrue': 0 };
  }

  // Now send some 90 degree headings to trigger change
  for (let i = 0; i < 15; i++) {
    const updates = await processTriggers(
      'navigation.headingTrue',
      90,
      state,
      log,
      app,
    );
    state = { ...state, ...updates, 'navigation.headingTrue': 90 };
  }

  // The average should eventually reach 90 and trigger the log
  const headingEntries = appended.filter(e => e.entry.text.includes('Heading changed to'));
  assert.strictEqual(headingEntries.length, 1, `Expected 1 heading change entry, but got ${headingEntries.length}. Entries: ${JSON.stringify(appended)}`);
  assert.ok(headingEntries[0].entry.text.includes('Heading changed to'), `Expected text to include 'Heading changed to', but got '${headingEntries[0].entry.text}'`);
});

test('processTriggers resets heading buffer when vessel stops', async () => {
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
  };

  // Fill buffer with 0s
  for (let i = 0; i < 10; i++) {
    const updates = await processTriggers('navigation.headingTrue', 0, state, log, app);
    state = { ...state, ...updates, 'navigation.headingTrue': 0 };
  }

  // Change state to anchored
  const stateUpdates = await processTriggers('navigation.state', 'anchored', state, log, app);
  state = { ...state, ...stateUpdates, 'navigation.state': 'anchored' };

  // Send 90 degree heading. It should NOT trigger because buffer was reset and we are not under way
  await processTriggers('navigation.headingTrue', 90, state, log, app);

  const headingEntries = appended.filter(e => e.entry.text.includes('Heading changed to'));
  assert.strictEqual(headingEntries.length, 0, `Expected 0 heading change entries, but got ${headingEntries.length}. Entries: ${JSON.stringify(appended)}`);
});

test('processTriggers ignores heading changes when logHeadingChanges is disabled', async () => {
  let appended = false;
  const log = {
    appendEntry: async () => {
      appended = true;
    },
  };
  const { app } = appHarness({ logHeadingChanges: false });

  let state = {
    'navigation.state': 'sailing',
    'navigation.headingTrue': 0,
  };

  // Fill buffer
  for (let i = 0; i < 10; i++) {
    const updates = await processTriggers('navigation.headingTrue', 0, state, log, app);
    state = { ...state, ...updates, 'navigation.headingTrue': 0 };
  }

  // Trigger change
  for (let i = 0; i < 15; i++) {
    const updates = await processTriggers('navigation.headingTrue', 90, state, log, app);
    state = { ...state, ...updates, 'navigation.headingTrue': 90 };
  }

  assert.strictEqual(appended, false);
});
