const test = require('node:test');
const assert = require('node:assert');
const {
  mkdtemp, writeFile, readFile, rm,
} = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { stringify, parse } = require('yaml');
const Log = require('../plugin/Log');

test('appendEntry does not wipe the day when a stored entry fails validation', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'logbook-test-'));
  try {
    const date = '2026-06-11';
    const stored = [
      { datetime: '2026-06-11T08:00:00.000Z', text: 'Departed', category: 'navigation' },
      {
        datetime: '2026-06-11T09:00:00.000Z',
        text: 'Sail change',
        position: { latitude: 48.7, longitude: -123.1, foo: 'bar' },
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
