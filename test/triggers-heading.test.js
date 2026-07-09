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

  // Fill buffer and set lastLoggedHeading
  for (let i = 0; i < 10; i++) {
    const updates = await processTriggers('navigation.headingTrue', 0, state, log, app);
    state = { ...state, ...updates, 'navigation.headingTrue': 0 };
  }

  // Change heading to 90
  for (let i = 0; i < 15; i++) {
    const updates = await processTriggers('navigation.headingTrue', 90, state, log, app);
    state = { ...state, ...updates, 'navigation.headingTrue': 90 };
  }

  const headingEntries = appended.filter((e) => e.entry.text.includes('Heading changed to'));
  assert.strictEqual(headingEntries.length, 1);
  assert.ok(headingEntries[0].entry.text.includes('Heading changed to'), `Expected text to include 'Heading changed to', but got '${headingEntries[0].entry.text}'`);
});

test('processTriggers logs tack when wind side changes via bow', async () => {
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
  for (let i = 0; i < 10; i++) {
    const updates = await processTriggers('navigation.headingTrue', 0, state, log, app);
    state = { ...state, ...updates, 'navigation.headingTrue': 0 };
  }

  // Change heading to 180.
  // Wind 140, H_old 0 -> R_old = 140 (Starboard)
  // Wind 140, H_new 180 -> R_new = 320 (Port)
  // Side changed from Starboard to Port. DeltaR = -80 (Tack).
  for (let i = 0; i < 15; i++) {
    const updates = await processTriggers('navigation.headingTrue', 180, state, log, app);
    state = { ...state, ...updates, 'navigation.headingTrue': 180 };
  }

  const tackEntries = appended.filter((e) => e.entry.text.includes('Tack'));
  assert.strictEqual(tackEntries.length, 1);
  assert.ok(tackEntries[0].entry.text.includes('Tack (Heading 180°)'));
});

test('processTriggers logs gybe when wind side changes via stern', async () => {
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
  for (let i = 0; i < 10; i++) {
    const updates = await processTriggers('navigation.headingTrue', 0, state, log, app);
    state = { ...state, ...updates, 'navigation.headingTrue': 0 };
  }

  // Change heading to 200.
  // Wind 140, H_old 0 -> R_old = 140 (Starboard)
  // Wind 140, H_new 200 -> R_new = 300 (Port)
  // Side changed from Starboard to Port. DeltaR = 160 (Gybe).
  for (let i = 0; i < 15; i++) {
    const updates = await processTriggers('navigation.headingTrue', 200, state, log, app);
    state = { ...state, ...updates, 'navigation.headingTrue': 200 };
  }

  const gybeEntries = appended.filter((e) => e.entry.text.includes('Gybe'));
  assert.strictEqual(gybeEntries.length, 1);
  assert.ok(gybeEntries[0].entry.text.includes('Gybe'), `Expected text to include 'Gybe', but got '${gybeEntries[0].entry.text}'`);
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

  const headingEntries = appended.filter((e) => e.entry.text.includes('Heading changed to'));
  assert.strictEqual(headingEntries.length, 0);
});
