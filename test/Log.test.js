const test = require('node:test');
const assert = require('node:assert');
const {
  mkdtemp, writeFile, readFile, rm,
} = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { stringify, parse } = require('yaml');
const Log = require('../plugin/Log');
const { isUuid } = require('../plugin/provider');

test('legacy writes notify the change listener with the stored entry', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'logbook-test-'));
  try {
    const log = new Log(dir);
    const events = [];
    log.setChangeListener((entry, change) => events.push({ entry, change }));

    const appended = await log.appendEntry('2026-06-11', {
      datetime: '2026-06-11T08:00:00.000Z',
      text: 'Departed',
      category: 'navigation',
    });
    assert.ok(appended.id, 'appendEntry resolves with the stored entry');
    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0].change, 'write');
    assert.strictEqual(events[0].entry.id, appended.id);

    const written = await log.writeEntry({
      id: appended.id,
      datetime: '2026-06-11T08:00:00.000Z',
      text: 'Departed under power',
      category: 'navigation',
    });
    assert.strictEqual(written.text, 'Departed under power');
    assert.strictEqual(events.length, 2);
    assert.strictEqual(events[1].change, 'write');

    const deleted = await log.deleteEntry('2026-06-11T08:00:00.000Z');
    assert.strictEqual(deleted.id, appended.id, 'deleteEntry resolves with the removed entry');
    assert.strictEqual(events.length, 3);
    assert.strictEqual(events[2].change, 'delete');
    assert.strictEqual(events[2].entry.id, appended.id);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('provider-path writes and migration do not notify the change listener', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'logbook-test-'));
  try {
    const log = new Log(dir);
    let calls = 0;
    log.setChangeListener(() => {
      calls += 1;
    });

    const appended = await log.appendEntry('2026-06-11', {
      datetime: '2026-06-11T08:00:00.000Z',
      text: 'Departed',
      category: 'navigation',
    });
    assert.strictEqual(calls, 1);

    // The resources provider path is deltified by the server
    await log.upsertEntry(appended.id, {
      id: appended.id,
      datetime: '2026-06-11T08:00:00.000Z',
      text: 'Upserted',
      category: 'navigation',
    });
    await log.deleteEntryById(appended.id);
    assert.strictEqual(calls, 1, 'upsertEntry/deleteEntryById never notify');

    // Migration rewrites day files without notifying
    await log.migrate();
    assert.strictEqual(calls, 1, 'migration never notifies');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('a throwing change listener never fails the write', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'logbook-test-'));
  try {
    const log = new Log(dir);
    log.setChangeListener(() => {
      throw new Error('listener boom');
    });
    const appended = await log.appendEntry('2026-06-11', {
      datetime: '2026-06-11T08:00:00.000Z',
      text: 'Departed',
      category: 'navigation',
    });
    assert.ok(appended.id, 'the write still resolved');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('writeEntry does not wipe the day when a stored entry fails validation', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'logbook-test-'));
  try {
    const date = '2026-06-11';
    const stored = [
      { datetime: '2026-06-11T08:00:00.000Z', text: 'Departed', category: 'navigation' },
      {
        datetime: '2026-06-11T09:00:00.000Z',
        text: 'Sail change',
        position: { latitude: 48.7, longitude: -123.1 },
        heading: 'not-a-number',
      },
    ];
    await writeFile(join(dir, `${date}.yml`), stringify(stored), 'utf-8');

    const log = new Log(dir);
    const edited = {
      datetime: '2026-06-11T08:00:00.000Z', text: 'Departed under power', category: 'navigation',
    };

    let threw = false;
    try {
      await log.writeEntry(edited);
    } catch (e) {
      threw = true;
    }

    const after = parse(await readFile(join(dir, `${date}.yml`), 'utf-8'));
    assert.strictEqual(after.length, 2, 'all original entries for the day must be preserved');
    assert.ok(threw, 'writeEntry should reject when the stored day cannot be read');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('appendEntry does not wipe the day when a stored entry fails validation', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'logbook-test-'));
  try {
    const date = '2026-06-11';
    const stored = [
      { datetime: '2026-06-11T08:00:00.000Z', text: 'Departed', category: 'navigation' },
      {
        datetime: '2026-06-11T09:00:00.000Z',
        text: 'Sail change',
        position: { latitude: 48.7, longitude: -123.1 },
        heading: 'not-a-number',
      },
    ];
    await writeFile(join(dir, `${date}.yml`), stringify(stored), 'utf-8');

    const log = new Log(dir);
    const newEntry = {
      datetime: '2026-06-11T10:00:00.000Z', text: 'Engine on', category: 'engine',
    };

    let threw = false;
    try {
      await log.appendEntry(date, newEntry);
    } catch (e) {
      threw = true;
    }

    const after = parse(await readFile(join(dir, `${date}.yml`), 'utf-8'));
    assert.strictEqual(after.length, 2, 'all original entries for the day must be preserved');
    assert.ok(threw, 'appendEntry should reject when the stored day cannot be read');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('appendEntry creates a new day file when none exists', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'logbook-test-'));
  try {
    const log = new Log(dir);
    const date = '2026-06-12';
    const entry = {
      datetime: '2026-06-12T10:00:00.000Z', text: 'Engine on', category: 'engine',
    };

    await log.appendEntry(date, entry);

    const after = parse(await readFile(join(dir, `${date}.yml`), 'utf-8'));
    assert.strictEqual(after.length, 1);
    assert.strictEqual(after[0].text, 'Engine on');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('getDate assigns origin to legacy entries at read time', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'logbook-test-'));
  try {
    const date = '2026-06-11';
    const stored = [
      { datetime: '2026-06-11T08:00:00.000Z', text: 'Hourly entry' },
      { datetime: '2026-06-11T09:00:00.000Z', text: 'Sail change', author: 'bryan' },
      {
        datetime: '2026-06-11T10:00:00.000Z', text: 'Drill logged', author: 'poseidon', origin: 'agent',
      },
    ];
    await writeFile(join(dir, `${date}.yml`), stringify(stored), 'utf-8');

    const log = new Log(dir);
    const entries = await log.getDate(date);
    assert.strictEqual(entries[0].origin, 'auto', 'authorless legacy entries read as auto');
    assert.strictEqual(entries[1].origin, 'manual', 'authored legacy entries read as manual');
    assert.strictEqual(entries[2].origin, 'agent', 'stored origin is preserved');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('writeEntry creates a new day file when none exists', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'logbook-test-'));
  try {
    const log = new Log(dir);
    const entry = {
      datetime: '2026-06-12T10:00:00.000Z', text: 'Departed', category: 'navigation',
    };
    await log.writeEntry(entry);
    const after = parse(await readFile(join(dir, '2026-06-12.yml'), 'utf-8'));
    assert.strictEqual(after.length, 1);
    assert.strictEqual(after[0].text, 'Departed');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

const STATE_FILE = '.migration.json';

async function readState(dir) {
  return JSON.parse(await readFile(join(dir, STATE_FILE), 'utf-8'));
}

test('migration state file: completed storage boots on the fast path without touching day files', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'logbook-test-'));
  try {
    const dayFile = join(dir, '2026-06-11.yml');
    const preMigration = [{ datetime: '2026-06-11T08:00:00.000Z', text: 'one' }];
    await writeFile(dayFile, stringify(preMigration), 'utf-8');

    const log = new Log(dir);
    const progress = [];
    await log.migrate({ onProgress: (message) => progress.push(message) });
    assert.ok(progress.length > 0, 'pending migrations report progress');
    const day = parse(await readFile(dayFile, 'utf-8'));
    assert.ok(isUuid(day[0].id), 'scan stamped the id');
    const saved = await readState(dir);
    assert.strictEqual(saved.version, Log.MIGRATION_VERSION);
    assert.strictEqual(saved.index[day[0].id], '2026-06-11', 'state file carries the id index');

    // Hand-edit the day file afterwards (adding an id-less entry): the
    // fast path must serve ids from the state file without a rescan and
    // without rewriting any day file
    await writeFile(dayFile, stringify([
      ...preMigration.map((e) => ({ ...e, id: day[0].id })),
      { datetime: '2026-06-11T09:00:00.000Z', text: 'hand-added' },
    ]), 'utf-8');
    const log2 = new Log(dir);
    const progress2 = [];
    await log2.migrate({ onProgress: (message) => progress2.push(message) });
    assert.strictEqual(progress2.length, 0, 'up-to-date storage runs no migration');
    const dayAgain = parse(await readFile(dayFile, 'utf-8'));
    assert.ok(!dayAgain[1].id, 'fast path left day files untouched');
    const fetched = await log2.getEntryById(day[0].id);
    assert.strictEqual(fetched.text, 'one');
    // The state file is not confusable with log data
    assert.deepStrictEqual(await log2.listDates(), ['2026-06-11']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('writes keep the state file index current, but only for a migrated storage', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'logbook-test-'));
  try {
    const log = new Log(dir);
    // No migration has completed: writes must not create a state file, so
    // a partial index can never pass for a fully migrated storage
    await log.appendEntry('2026-06-11', {
      datetime: '2026-06-11T08:00:00.000Z', text: 'before migration',
    });
    await assert.rejects(readState(dir), { code: 'ENOENT' });

    await log.migrate();
    const appended = await log.appendEntry('2026-06-12', {
      datetime: '2026-06-12T08:00:00.000Z', text: 'after migration',
    });
    await log._saveMigrationState();
    const saved = await readState(dir);
    assert.strictEqual(saved.index[appended.id], '2026-06-12');

    // The next boot finds the entry written after the migration
    const log2 = new Log(dir);
    await log2.migrate();
    const fetched = await log2.getEntryById(appended.id);
    assert.strictEqual(fetched.text, 'after migration');

    // Deleting it updates the persisted index too
    await log2.deleteEntryById(appended.id);
    await log2._saveMigrationState();
    const savedAfterDelete = await readState(dir);
    assert.strictEqual(savedAfterDelete.index[appended.id], undefined);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('an out-of-date state file version reruns the whole migration', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'logbook-test-'));
  try {
    const dayFile = join(dir, '2026-06-11.yml');
    await writeFile(dayFile, stringify([
      { datetime: '2026-06-11T08:00:00.000Z', text: 'one' },
    ]), 'utf-8');
    // A marker from an older plugin generation…
    await writeFile(join(dir, STATE_FILE), JSON.stringify({
      version: Math.max(0, Log.MIGRATION_VERSION - 1),
      index: {},
    }), 'utf-8');
    const log = new Log(dir);
    const progress = [];
    await log.migrate({ onProgress: (message) => progress.push(message) });
    let day = parse(await readFile(dayFile, 'utf-8'));
    assert.ok(isUuid(day[0].id), 'older version reran the migration');
    assert.ok(progress.length > 0, 'progress reported for pending migrations');
    const saved = await readState(dir);
    assert.strictEqual(saved.version, Log.MIGRATION_VERSION, 'state file updated to current version');

    // …and one from a newer generation (downgraded plugin): never trusted,
    // the storage is brought back to the versions this plugin knows
    await writeFile(dayFile, stringify([
      { datetime: '2026-06-11T08:00:00.000Z', text: 'one' },
    ]), 'utf-8');
    await writeFile(join(dir, STATE_FILE), JSON.stringify({
      version: Log.MIGRATION_VERSION + 10,
      index: {},
    }), 'utf-8');
    const log2 = new Log(dir);
    await log2.migrate();
    day = parse(await readFile(dayFile, 'utf-8'));
    assert.ok(isUuid(day[0].id), 'newer-version marker reran the migration');
    const savedAfter = await readState(dir);
    assert.strictEqual(savedAfter.version, Log.MIGRATION_VERSION);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('a failed migration writes no state file, so the next start retries', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'logbook-test-'));
  try {
    await writeFile(join(dir, '2026-06-11.yml'), stringify([
      { datetime: '2026-06-11T08:00:00.000Z', text: 'one' },
    ]), 'utf-8');
    const log = new Log(dir);
    const original = log._migrateEntryIds;
    log._migrateEntryIds = () => Promise.reject(new Error('disk went to sea'));
    await assert.rejects(log.migrate(), /disk went to sea/);
    await assert.rejects(readState(dir), { code: 'ENOENT' }, 'no marker after a failed chain');
    // Next start: the migration runs again and completes
    log._migrateEntryIds = original;
    await log.migrate();
    const day = parse(await readFile(join(dir, '2026-06-11.yml'), 'utf-8'));
    assert.ok(isUuid(day[0].id));
    const saved = await readState(dir);
    assert.strictEqual(saved.version, Log.MIGRATION_VERSION);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
