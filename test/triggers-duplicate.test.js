const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Log = require('../plugin/Log');

// Boots the real plugin with a minimal mocked Signal K `app`. The subscription
// callback is captured so the test can feed in deltas directly.
function makeApp(dataDir) {
  let deltaCallback = null;
  const app = {
    selfId: 'self',
    debug: () => {},
    error: () => {},
    setPluginError: () => {},
    setPluginStatus: () => {},
    setProviderStatus: () => {},
    getDataDirPath: () => dataDir,
    readPluginOptions: () => ({ configuration: {} }),
    handleMessage: () => {},
    savePluginOptions: (cfg, cb) => {
      if (cb) {
        cb(null);
      }
    },
    registerPutHandler: () => {},
    registerWithRouter: () => {},
    getSelfPath: () => ({ value: null }),
    subscriptionmanager: {
      subscribe: (subscription, unsubscribes, onError, cb) => {
        deltaCallback = cb;
      },
    },
  };
  app.getDeltaCallback = () => deltaCallback;
  return app;
}

function delta(signalPath, value) {
  return {
    updates: [
      {
        $source: 'test',
        values: [{ path: signalPath, value }],
      },
    ],
  };
}

// Poll the on-disk log until the entry count stabilizes across two reads, so
// the test observes the final state once all async writes have drained.
async function settle(dir, date) {
  const log = new Log(dir);
  let last = [];
  for (let i = 0; i < 30; i += 1) {
    let current = [];
    try {
      // eslint-disable-next-line no-await-in-loop
      current = await log.getDate(date);
    } catch (err) {
      current = [];
    }
    if (i > 0 && current.length === last.length) {
      return current;
    }
    last = current;
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => {
      setTimeout(r, 10);
    });
  }
  return last;
}

test('rapid duplicate deltas produce only a single log entry', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'logbook-dup-'));
  const app = makeApp(dir);
  // eslint-disable-next-line global-require
  const plugin = require('../plugin/index')(app);
  plugin.start();
  try {
    const cb = app.getDeltaCallback();
    const date = new Date().toISOString().substr(0, 10);

    // Seed state with the "stopped" value so the change below is treated as a
    // real transition rather than an initial value (which triggers ignore).
    cb(delta('propulsion.port.state', 'stopped'));
    await settle(dir, date);

    // Fire the SAME change twice, back to back, without awaiting. Before delta
    // serialization this raced on `state` and wrote two engine-start entries.
    cb(delta('propulsion.port.state', 'started'));
    cb(delta('propulsion.port.state', 'started'));

    const entries = await settle(dir, date);
    const started = entries.filter((e) => e.text === 'Started port engine');
    assert.strictEqual(
      started.length,
      1,
      `Expected 1 engine-start entry, got ${started.length}: ${JSON.stringify(entries.map((e) => e.text))}`,
    );
  } finally {
    plugin.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
