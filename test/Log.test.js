const test = require('node:test');
const assert = require('node:assert');
const {
  mkdtemp, writeFile, readFile, rm,
} = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { stringify, parse } = require('yaml');
const Log = require('../plugin/Log');

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
