const test = require('node:test');
const assert = require('node:assert');
const { existsSync } = require('node:fs');
const { mkdtemp, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { randomUUID } = require('node:crypto');
const Log = require('../plugin/Log');
const { createLogentriesProvider } = require('../plugin/provider');
const createPlugin = require('../plugin/index');
const {
  PLOTTER_EXTENSION,
  createPlotterExtensionProvider,
} = require('../plugin/plotterExtension');
const pkg = require('../package.json');

// Minimal plugin host: enough app surface for start() to run against a
// temp data dir, capturing registered resource providers
function mockApp(dataDir, providers) {
  return {
    debug: () => {},
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
    registerResourceProvider: (provider) => providers.push(provider),
  };
}

async function withStartedPlugin(run) {
  const providers = [];
  const dir = await mkdtemp(join(tmpdir(), 'logbook-plotterext-'));
  const app = mockApp(dir, providers);
  const plugin = createPlugin(app);
  plugin.start();
  try {
    await plugin.ready;
    await run(plugin, providers);
  } finally {
    plugin.stop();
    await rm(dir, { recursive: true, force: true });
  }
}

/** Maps a manifest URL to the file the server serves for it. */
function publicFile(url) {
  const prefix = `/${pkg.name}/`;
  assert.ok(url.startsWith(prefix), `${url} is under ${prefix}`);
  return join(__dirname, '..', 'public', url.slice(prefix.length));
}

// The view helpers are plain browser ES modules, loaded here once for
// the conversion tests
let view;
async function loadView() {
  if (!view) {
    view = await import('../public_src/plotterext/view.js');
  }
  return view;
}

test('plotterExtensions provider registers with the running manifest', async () => {
  await withStartedPlugin(async (plugin, providers) => {
    const provider = providers.find((p) => p.type === 'plotterExtensions');
    assert.ok(provider, 'provider registered');
    assert.deepStrictEqual(await provider.methods.listResources(), {
      'signalk-logbook': PLOTTER_EXTENSION,
    });
    assert.strictEqual(
      await provider.methods.getResource('signalk-logbook'),
      PLOTTER_EXTENSION,
    );
  });
});

test('plotterExtensions provider serves nothing once the plugin stops', async () => {
  const providers = [];
  const dir = await mkdtemp(join(tmpdir(), 'logbook-plotterext-'));
  const app = mockApp(dir, providers);
  const plugin = createPlugin(app);
  plugin.start();
  await plugin.ready;
  plugin.stop();
  const provider = providers.find((p) => p.type === 'plotterExtensions');
  assert.deepStrictEqual(await provider.methods.listResources(), {});
  await assert.rejects(
    provider.methods.getResource('signalk-logbook'),
    /No such plotterExtensions resource/,
  );
  await rm(dir, { recursive: true, force: true });
});

test('plotterExtensions provider is read-only', async () => {
  const methods = createPlotterExtensionProvider({
    providerId: 'signalk-logbook',
    isRunning: () => true,
  });
  await assert.rejects(methods.setResource(), /read-only provider/);
  await assert.rejects(methods.deleteResource(), /read-only provider/);
});

test('plotterExtensions provider rejects unknown ids like missing resources', async () => {
  const methods = createPlotterExtensionProvider({
    providerId: 'signalk-logbook',
    isRunning: () => true,
  });
  await assert.rejects(
    methods.getResource(randomUUID()),
    /No such plotterExtensions resource/,
  );
});

test('plotter extension manifest targets API version 1 with the package version', () => {
  assert.strictEqual(PLOTTER_EXTENSION.apiVersion, '1');
  assert.strictEqual(PLOTTER_EXTENSION.version, pkg.version);
});

test('the manifest toolbar button opens a panel of this manifest', () => {
  const panelIds = PLOTTER_EXTENSION.panels.map((p) => p.id);
  PLOTTER_EXTENSION.buttons.forEach((button) => {
    assert.strictEqual(button.action.type, 'toggleWindow');
    assert.ok(panelIds.includes(button.action.panel), button.id);
  });
});

test('every page the manifest points at ships in public/', () => {
  [...PLOTTER_EXTENSION.panels].map((c) => c.url).forEach((url) => {
    assert.ok(existsSync(publicFile(url)), url);
  });
});

test('form vocabularies match the webapp entry editor', async () => {
  const { CATEGORIES, SEA_STATES, VISIBILITY } = await loadView();
  assert.deepStrictEqual(CATEGORIES, ['navigation', 'engine', 'radio', 'maintenance']);
  assert.strictEqual(SEA_STATES.length, 10);
  assert.strictEqual(VISIBILITY.length, 10);
});

test('sea state maps Douglas codes onto the Beaufort scale', async () => {
  const { douglasToBeaufort } = await loadView();
  assert.strictEqual(douglasToBeaufort(0), 0);
  assert.strictEqual(douglasToBeaufort(3), 3);
  assert.strictEqual(douglasToBeaufort(4), 5);
  assert.strictEqual(douglasToBeaufort(9), 12);
  assert.strictEqual(douglasToBeaufort(-1), null);
  assert.strictEqual(douglasToBeaufort(10), null);
});

test('cloud coverage maps oktas onto a ratio', async () => {
  const { oktasToRatio } = await loadView();
  assert.strictEqual(oktasToRatio(0), 0);
  assert.strictEqual(oktasToRatio(4), 0.5);
  assert.strictEqual(oktasToRatio(8), 1);
  assert.strictEqual(oktasToRatio(-1), null);
  assert.strictEqual(oktasToRatio(9), null);
});

test('a bare entry defaults to navigation now, with no telemetry', async () => {
  const { buildEntryPayload } = await loadView();
  const now = new Date('2026-03-15T12:00:00Z');
  const payload = buildEntryPayload({ text: 'Changed watch' }, now);
  assert.deepStrictEqual(payload, {
    text: 'Changed watch',
    category: 'navigation',
    origin: 'manual',
    datetime: '2026-03-15T12:00:00.000Z',
  });
});

test('quick choices date the entry minutes back', async () => {
  const { buildEntryPayload } = await loadView();
  const now = new Date('2026-03-15T12:00:00Z');
  const payload = buildEntryPayload({ text: 'x', when: '5' }, now);
  assert.strictEqual(payload.datetime, '2026-03-15T11:55:00.000Z');
});

test('a specific datetime is kept as given', async () => {
  const { buildEntryPayload } = await loadView();
  const now = new Date('2026-03-15T12:00:00Z');
  const payload = buildEntryPayload({
    text: 'x',
    when: 'specific',
    // Parsed as device-local time, the same convention datetime-local
    // inputs and the webapp editor use
    datetime: '2026-03-15T09:30',
  }, now);
  assert.strictEqual(payload.datetime, new Date('2026-03-15T09:30').toISOString());
});

test('an unparseable specific datetime throws', async () => {
  const { buildEntryPayload } = await loadView();
  assert.throws(
    () => buildEntryPayload({ text: 'x', when: 'specific', datetime: 'not-a-time' }),
    /Invalid date and time/,
  );
});

test('a radio entry carries the VHF channel as telemetry', async () => {
  const { buildEntryPayload } = await loadView();
  const payload = buildEntryPayload({
    text: 'Called harbour master',
    category: 'radio',
    vhf: '16',
  });
  assert.strictEqual(payload.category, 'radio');
  assert.deepStrictEqual(payload.telemetry, [
    { path: 'communication.vhf.channel', value: '16' },
  ]);
});

test('observations convert to their SI pathvalues', async () => {
  const { buildEntryPayload } = await loadView();
  const payload = buildEntryPayload({
    text: 'x',
    category: 'navigation',
    seaState: 4,
    cloudCoverage: 4,
    visibility: 6,
  });
  assert.deepStrictEqual(payload.telemetry, [
    { path: 'environment.water.seaStateValue', value: 5 },
    { path: 'environment.outside.cloudCover', value: 0.5 },
    { path: 'environment.outside.visibility', value: 6 },
  ]);
});

test('unset observations (the -1 codes) produce no pathvalues', async () => {
  const { buildEntryPayload } = await loadView();
  const payload = buildEntryPayload({
    text: 'x',
    category: 'navigation',
    seaState: -1,
    cloudCoverage: -1,
    visibility: -1,
  });
  assert.strictEqual(payload.telemetry, undefined);
});

test('a manual position keeps its fix type and drops invalid values', async () => {
  const { buildEntryPayload } = await loadView();
  const valid = buildEntryPayload({
    text: 'x',
    category: 'navigation',
    latitude: '60.12345',
    longitude: '25.12345',
    fixType: 'GPS',
  });
  assert.deepStrictEqual(valid.telemetry, [
    { path: 'navigation.position', value: { latitude: 60.12345, longitude: 25.12345, source: 'GPS' } },
  ]);

  const outOfRange = buildEntryPayload({
    text: 'x',
    category: 'navigation',
    latitude: '91',
    longitude: '25',
  });
  assert.strictEqual(outOfRange.telemetry, undefined);
});

test('an unknown category falls back to navigation', async () => {
  const { buildEntryPayload } = await loadView();
  const payload = buildEntryPayload({ text: 'x', category: 'party' });
  assert.strictEqual(payload.category, 'navigation');
});

test('a plotter-submitted entry is accepted and served by the logentries provider', async () => {
  const { buildEntryPayload } = await loadView();
  const dir = await mkdtemp(join(tmpdir(), 'logbook-plotterext-e2e-'));
  const log = new Log(dir);
  const provider = createLogentriesProvider({
    app: {},
    log,
    bufferLookup: null,
    enginePaths: () => [],
    providerId: 'signalk-logbook',
  });
  try {
    // The window's Save button body, verbatim: full navigation entry
    const payload = buildEntryPayload({
      text: 'Rocks off the port bow',
      category: 'navigation',
      when: '5',
      seaState: 4,
      cloudCoverage: 4,
      visibility: 6,
      latitude: '60.12345',
      longitude: '25.12345',
      fixType: 'GPS',
    }, new Date('2026-03-15T12:00:00Z'));
    const id = randomUUID();
    await provider.setResource(id, payload);

    const stored = await provider.getResource(id);
    assert.strictEqual(stored.text, 'Rocks off the port bow');
    assert.strictEqual(stored.category, 'navigation');
    assert.strictEqual(stored.origin, 'manual');
    assert.strictEqual(stored.datetime, '2026-03-15T11:55:00.000Z');
    const pathvalues = new Map(stored.telemetry.map((pv) => [pv.path, pv.value]));
    assert.ok(pathvalues.has('environment.water.seaStateValue'), 'sea state stored');
    assert.strictEqual(pathvalues.get('environment.outside.cloudCover'), 0.5);
    assert.strictEqual(pathvalues.get('environment.outside.visibility'), 6);
    assert.deepStrictEqual(pathvalues.get('navigation.position'), {
      latitude: 60.12345,
      longitude: 25.12345,
      source: 'GPS',
    });

    // And a bare radio line with just a channel
    const vhfPayload = buildEntryPayload({
      text: 'Securite on channel 16',
      category: 'radio',
      vhf: '72',
    });
    const vhfId = randomUUID();
    await provider.setResource(vhfId, vhfPayload);
    const storedVhf = await provider.getResource(vhfId);
    const vhfValues = new Map(storedVhf.telemetry.map((pv) => [pv.path, pv.value]));
    assert.strictEqual(vhfValues.get('communication.vhf.channel'), '72');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
