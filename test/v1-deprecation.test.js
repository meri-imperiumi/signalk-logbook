const test = require('node:test');
const assert = require('node:assert');
const { mkdtemp, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const createPlugin = require('../plugin/index');

// Minimal plugin host: enough app surface for start() and
// registerWithRouter() to run against a temp data dir
function mockApp(dataDir, debugLines) {
  return {
    debug: (msg) => debugLines.push(msg),
    setPluginStatus: () => {},
    setPluginError: () => {},
    error: () => {},
    readPluginOptions: () => ({ configuration: { crewNames: [] } }),
    savePluginOptions: (config, cb) => cb(null),
    subscriptionmanager: {
      subscribe: () => {},
    },
    registerPutHandler: () => {},
    getDataDirPath: () => dataDir,
    handleMessage: () => {},
    registerResourceProvider: () => {},
  };
}

function mockRouter(withAccess) {
  const registered = [];
  const makeRegistrar = (level) => {
    const registrar = {};
    ['get', 'post', 'put', 'delete'].forEach((method) => {
      registrar[method] = (path, ...handlers) => {
        registered.push({
          level, method: method.toUpperCase(), path, handler: handlers[handlers.length - 1],
        });
        return registrar;
      };
    });
    return registrar;
  };
  const router = makeRegistrar(undefined);
  if (withAccess) {
    router.access = (level) => makeRegistrar(level);
  }
  router.registered = registered;
  return router;
}

function mockRes() {
  const headers = {};
  return {
    headers,
    set: (name, value) => {
      headers[name] = value;
    },
    contentType: () => {},
    send: () => {},
    sendStatus: () => {},
    status: () => ({ send: () => {} }),
  };
}

function mockReq(url) {
  return {
    method: 'GET', url, originalUrl: url, params: {}, body: {},
  };
}

async function withStartedPlugin(run) {
  const dir = await mkdtemp(join(tmpdir(), 'logbook-v1-'));
  const debugLines = [];
  const app = mockApp(dir, debugLines);
  const plugin = createPlugin(app);
  plugin.start();
  try {
    // Migration runs asynchronously; await it so the state file write is
    // not still in flight when the temp dir is removed
    await plugin.ready;
    await run(plugin, debugLines);
  } finally {
    plugin.stop();
    await rm(dir, { recursive: true, force: true });
  }
}

test('v1 routes register with router.access levels when available', async () => {
  await withStartedPlugin((plugin) => {
    const router = mockRouter(true);
    plugin.registerWithRouter(router);
    const levelFor = (method, path) => {
      const route = router.registered.find((r) => r.method === method && r.path === path);
      return route ? route.level : undefined;
    };
    assert.strictEqual(levelFor('GET', '/logs'), 'readonly');
    assert.strictEqual(levelFor('GET', '/logs/:date'), 'readonly');
    assert.strictEqual(levelFor('GET', '/logs/:date/:entry'), 'readonly');
    assert.strictEqual(levelFor('POST', '/logs'), 'readwrite');
    assert.strictEqual(levelFor('PUT', '/logs/:date/:entry'), 'readwrite');
    assert.strictEqual(levelFor('DELETE', '/logs/:date/:entry'), 'readwrite');
  });
});

test('v1 routes fall back to plain registration without router.access', async () => {
  await withStartedPlugin((plugin) => {
    const router = mockRouter(false);
    plugin.registerWithRouter(router);
    assert.strictEqual(router.registered.length, 6, 'all six routes registered');
    router.registered.forEach((route) => {
      assert.strictEqual(route.level, undefined, 'registered directly on the router');
    });
  });
});

test('v1 responses carry deprecation headers and hit the debug log', async () => {
  await withStartedPlugin(async (plugin, debugLines) => {
    const router = mockRouter(false);
    plugin.registerWithRouter(router);
    const { handler } = router.registered.find((r) => r.path === '/logs' && r.method === 'GET');
    const res = mockRes();
    handler(mockReq('/plugins/signalk-logbook/logs'), res);
    // Give the promise chain a tick to resolve
    await new Promise((resolve) => {
      setTimeout(resolve, 10);
    });
    assert.strictEqual(res.headers.Deprecation, 'true');
    assert.ok(res.headers.Link.includes('rel="deprecation"'));
    assert.ok(debugLines.some((line) => String(line).includes('Deprecated v1 log API')));
  });
});
