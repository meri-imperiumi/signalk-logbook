const {
  stat,
  readdir,
  readFile,
  writeFile,
  mkdir,
  copyFile,
  access,
  rename,
} = require('fs/promises');
const { join, basename } = require('path');
const { randomUUID } = require('crypto');
const { parse, stringify } = require('yaml');
const { Validator } = require('jsonschema');
const openAPI = require('../schema/openapi.json');

const DATE_PATTERN = /^\d{4}-([0]\d|1[0-2])-([0-2]\d|3[01])$/;
const MIGRATION_BACKUP_DIR = 'id-migration-backup';
// Startup state file: records which storage migrations have completed and
// carries the id → day index, so an up-to-date storage starts without
// parsing a single day file. Deliberately not a day file shape — a hidden
// dotfile whose name matches neither the `YYYY-MM-DD.yml` listing pattern
// nor the date validation — so storage scans and date-addressed operations
// can never mistake it for log data.
const MIGRATION_STATE_FILE = '.migration.json';

/**
 * Versioned startup migrations, run in ascending order over the whole
 * storage whenever `.migration.json` records an older version. Append new
 * migrations at the end with the next version number — never edit or
 * reorder existing entries — and keep every migration idempotent: the
 * state file is written only after the whole pending chain succeeds, so an
 * interrupted startup re-runs the chain from the recorded version.
 */
const MIGRATIONS = [
  {
    version: 1,
    description: 'stamping entry ids',
    run: (log) => log._migrateEntryIds(),
  },
];
const CURRENT_MIGRATION_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;

class Log {
  constructor(dir) {
    this.dir = dir;
    this.validator = null;
    this.queues = new Map(); // Tracks active promises per date to prevent race conditions
    // In-memory index of entry id → date string. Loaded from the persisted
    // migration state (or built by the migration scan when one runs) and
    // maintained on writes, so id-addressed operations find the right day
    // file without scanning every file.
    this.idIndex = new Map();
    // True once the storage is known to be at the current migration
    // version — either loaded from `.migration.json` or after the pending
    // chain completed. Only then may the state file be (re-)written, so a
    // partial index can never pass for a fully migrated storage.
    this.migrationCompleted = false;
    // Serializes the state file writes fired from the write paths
    this.stateSaveChain = Promise.resolve();
    // Listener invoked after each successful write made through the legacy
    // write methods (appendEntry, writeEntry, deleteEntry) — the writes
    // that bypass the resources provider and must emit their own
    // resources.logentries deltas. Provider writes (upsertEntry,
    // deleteEntryById) are deltified by the server and never notify.
    this.changeListener = null;
  }

  /**
   * Register a listener called with (entry, change) after each successful
   * legacy write — `entry` being the stored (or, for 'delete', the removed)
   * entry in its storage shape, `change` being 'write' or 'delete'. A
   * throwing listener never fails the write it observes.
   */
  setChangeListener(listener) {
    this.changeListener = listener;
  }

  _notifyChange(entry, change) {
    if (!this.changeListener) {
      return;
    }
    try {
      this.changeListener(entry, change);
    } catch (err) {
      // Delta emission or any other listener must never fail the write
    }
  }

  // --- CONCURRENCY CONTROL ---

  _enqueue(date, task) {
    const current = this.queues.get(date) || Promise.resolve();
    const promise = current.then(() => task());

    // Catch errors so a failed task doesn't permanently break the queue for this date file
    this.queues.set(date, promise.catch(() => {}));
    return promise;
  }

  // --- INTERNAL DISK OPERATIONS (Unqueued) ---

  _getDateInternal(date) {
    if (!date.match(DATE_PATTERN)) {
      return Promise.reject(new Error('Invalid date format'));
    }
    const path = this.getPath(date);
    return stat(path)
      .then((stats) => {
        if (!stats.isFile()) {
          throw new Error(`Log for ${date} not found`);
        }
        return readFile(path, 'utf-8');
      })
      .then((content) => {
        if (!content) {
          return [];
        }
        return parse(content);
      })
      .then((data) => this.validateDate(data)
        .then((valid) => {
          if (valid.errors.length > 0) {
            return Promise.reject(valid.errors[0]);
          }
          return data.map((entry) => ({
            ...entry,
            category: entry.category || 'navigation',
            origin: entry.origin || (entry.author ? 'manual' : 'auto'),
            datetime: new Date(entry.datetime),
          }));
        }));
  }

  _writeDateInternal(date, data) {
    if (!date.match(DATE_PATTERN)) {
      return Promise.reject(new Error('Invalid date format'));
    }
    const path = this.getPath(date);
    Log.sortDate(data);
    const normalized = data.map((e) => ({
      ...e,
      datetime: e.datetime.toISOString(),
    }));
    return this.validateDate(normalized)
      .then((valid) => {
        if (valid.errors.length > 0) {
          return Promise.reject(valid.errors[0]);
        }
        const yaml = stringify(normalized);
        return writeFile(path, yaml, 'utf-8');
      });
  }

  // --- PUBLIC API ---

  listDates() {
    return readdir(this.dir)
      .then((dates) => {
        const valid = dates.filter((e) => e.match(/^\d{4}-([0]\d|1[0-2])-([0-2]\d|3[01])\.yml$/));
        return valid.map((v) => basename(v, '.yml'));
      });
  }

  getDate(date) {
    return this._enqueue(date, () => this._getDateInternal(date));
  }

  getEntry(datetime) {
    const datetimeString = new Date(datetime).toISOString();
    // Uses public getDate, which handles queuing safely
    return this.getDate(datetimeString.substr(0, 10))
      .then((dateData) => {
        const entry = dateData.find((e) => e.datetime.toISOString() === datetimeString);
        if (!entry) {
          const err = new Error(`Entry ${datetimeString} not found`);
          err.code = 'ENOENT';
          return Promise.reject(err);
        }
        return {
          ...entry,
          category: entry.category || 'navigation',
          datetime: new Date(entry.datetime),
        };
      });
  }

  getEntryById(id) {
    const date = this.idIndex.get(id);
    if (!date) {
      const err = new Error(`Entry ${id} not found`);
      err.code = 'ENOENT';
      return Promise.reject(err);
    }
    return this.getDate(date)
      .then((dateData) => {
        const entry = dateData.find((e) => e.id === id);
        if (!entry) {
          const err = new Error(`Entry ${id} not found`);
          err.code = 'ENOENT';
          return Promise.reject(err);
        }
        return entry;
      });
  }

  writeDate(date, data) {
    return this._enqueue(date, () => this._writeDateInternal(date, data));
  }

  writeEntry(entry) {
    const datetimeString = new Date(entry.datetime).toISOString();
    const dateString = datetimeString.substr(0, 10);

    return this._enqueue(dateString, () => this.validateEntry(entry)
      .then((valid) => {
        if (valid.errors.length > 0) {
          return Promise.reject(valid.errors[0]);
        }
        return this._getDateInternal(dateString).catch((err) => {
          if (err.code === 'ENOENT') {
            return [];
          }
          throw err;
        });
      })
      .then((dateData) => {
        const idx = dateData.findIndex((e) => e.datetime.toISOString() === datetimeString);
        // Keep every stored entry carrying its id: inherit the matched
        // entry's id on edit, assign a fresh one for a new datetime.
        const id = entry.id || (idx !== -1 ? dateData[idx].id : undefined) || randomUUID();
        const normalized = {
          ...entry,
          id,
          datetime: new Date(entry.datetime),
        };
        const updatedDate = [...dateData];
        if (idx === -1) {
          updatedDate.push(normalized);
        } else {
          updatedDate[idx] = normalized;
          const previousId = dateData[idx].id;
          if (previousId && previousId !== id) {
            this.idIndex.delete(previousId);
          }
        }
        this.idIndex.set(id, dateString);
        this._saveMigrationState();
        return this._writeDateInternal(dateString, updatedDate)
          .then(() => {
            this._notifyChange(normalized, 'write');
            return normalized;
          });
      }));
  }

  appendEntry(date, data) {
    return this._enqueue(date, () => this.validateEntry(data)
      .then((valid) => {
        if (valid.errors.length > 0) {
          return Promise.reject(valid.errors[0]);
        }
        return this._getDateInternal(date).catch((err) => {
          if (err.code === 'ENOENT') {
            return [];
          }
          throw err;
        });
      })
      .then((d) => {
        const id = data.id || randomUUID();
        const normalized = {
          ...data,
          id,
          datetime: new Date(data.datetime),
        };
        d.push(normalized);
        this.idIndex.set(id, date);
        this._saveMigrationState();
        return this._writeDateInternal(date, d)
          .then(() => {
            this._notifyChange(normalized, 'write');
            return normalized;
          });
      }));
  }

  /**
   * Create-or-replace an entry addressed by its id (the resources API
   * upsert). When the replacement moves the entry to another day file,
   * it is executed write-new-then-delete-old, each step under its date's
   * queue — a crash between the steps leaves at worst a duplicate, which
   * the startup scan deduplicates.
   */
  upsertEntry(id, entry) {
    if (entry.id && entry.id !== id) {
      return Promise.reject(new Error('Entry id does not match the resource id'));
    }
    const data = {
      ...entry,
      id,
    };
    const datetime = new Date(data.datetime);
    if (Number.isNaN(datetime.getTime())) {
      return Promise.reject(new Error('Invalid datetime'));
    }
    const newDate = datetime.toISOString().substr(0, 10);
    const oldDate = this.idIndex.get(id);

    const writeNew = () => this._enqueue(newDate, () => this.validateEntry(data)
      .then((valid) => {
        if (valid.errors.length > 0) {
          return Promise.reject(valid.errors[0]);
        }
        return this._getDateInternal(newDate).catch((err) => {
          if (err.code === 'ENOENT') {
            return [];
          }
          throw err;
        });
      })
      .then((dateData) => {
        const normalized = {
          ...data,
          datetime,
        };
        const updatedDate = [...dateData];
        const idx = updatedDate.findIndex((e) => e.id === id);
        if (idx === -1) {
          updatedDate.push(normalized);
        } else {
          updatedDate[idx] = normalized;
        }
        return this._writeDateInternal(newDate, updatedDate);
      }))
      .then(() => {
        this.idIndex.set(id, newDate);
        this._saveMigrationState();
      });

    if (!oldDate || oldDate === newDate) {
      return writeNew();
    }
    return writeNew()
      .then(() => this._enqueue(oldDate, () => this._getDateInternal(oldDate)
        .then((dateData) => {
          const idx = dateData.findIndex((e) => e.id === id);
          if (idx === -1) {
            return undefined;
          }
          dateData.splice(idx, 1);
          return this._writeDateInternal(oldDate, dateData);
        })));
  }

  deleteEntryById(id) {
    const date = this.idIndex.get(id);
    if (!date) {
      const err = new Error(`Entry ${id} not found`);
      err.code = 'ENOENT';
      return Promise.reject(err);
    }
    return this._enqueue(date, () => this._getDateInternal(date)
      .then((dateData) => {
        const entryIdx = dateData.findIndex((e) => e.id === id);
        if (entryIdx === -1) {
          const err = new Error(`Entry ${id} not found`);
          err.code = 'ENOENT';
          return Promise.reject(err);
        }
        dateData.splice(entryIdx, 1);
        return this._writeDateInternal(date, dateData);
      }))
      .then(() => {
        if (this.idIndex.get(id) === date) {
          this.idIndex.delete(id);
          this._saveMigrationState();
        }
      });
  }

  deleteEntry(datetimeString) {
    const dateString = datetimeString.substr(0, 10);

    return this._enqueue(dateString, () => this._getDateInternal(dateString)
      .then((dateData) => {
        const entryIdx = dateData.findIndex((e) => e.datetime.toISOString() === datetimeString);
        if (entryIdx === -1) {
          const err = new Error(`Entry ${datetimeString} not found`);
          err.code = 'ENOENT';
          return Promise.reject(err);
        }
        const [deleted] = dateData.splice(entryIdx, 1);
        if (deleted.id && this.idIndex.get(deleted.id) === dateString) {
          this.idIndex.delete(deleted.id);
          this._saveMigrationState();
        }
        return this._writeDateInternal(dateString, dateData)
          .then(() => {
            this._notifyChange(deleted, 'delete');
            return deleted;
          });
      }));
  }

  getPath(date) {
    const dateString = new Date(date).toISOString().substr(0, 10);
    return join(this.dir, `${dateString}.yml`);
  }

  static sortDate(data) {
    return data.sort((a, b) => {
      if (a.datetime < b.datetime) {
        return -1;
      }
      if (a.datetime > b.datetime) {
        return 1;
      }
      // Same-millisecond entries are allowed; ids break ties so the
      // ordering is deterministic.
      if (a.id < b.id) {
        return -1;
      }
      if (a.id > b.id) {
        return 1;
      }
      return 0;
    });
  }

  /**
   * Bring the storage up to the current migration version, then report it
   * ready. Reads `.migration.json` from the data directory: when it
   * records the current version and index, the id index is loaded from it
   * and the promise resolves without a single day file being read — the
   * fast path every startup of an unchanged plugin takes. Otherwise (file
   * missing, older version, or a newer one — a downgrade) every pending
   * migration runs in ascending order over all day files, with progress
   * reported through `options.onProgress`. The state file is written only
   * after the whole chain succeeds, so an interrupted startup leaves it
   * unwritten and the next start re-runs the chain from the recorded
   * version — migrations are idempotent, making that re-run safe. There
   * are no partial migrations: a storage is either at the recorded version
   * or the whole pending chain is replayed.
   *
   * Afterwards the state file doubles as the persisted id → date index;
   * every later index mutation re-persists it (serialized, best-effort),
   * keeping boots fast. Deleting the file forces a full migration re-run
   * at the next start.
   */
  migrate(options) {
    const { onProgress } = options || {};
    return readFile(join(this.dir, MIGRATION_STATE_FILE), 'utf-8')
      .then((content) => JSON.parse(content))
      .catch(() => null)
      .then((saved) => {
        const storedVersion = saved
          && typeof saved.version === 'number'
          && Number.isInteger(saved.version)
          && saved.version >= 1
          && saved.version <= CURRENT_MIGRATION_VERSION
          && saved.index
          && typeof saved.index === 'object'
          ? saved.version : 0;
        if (storedVersion === CURRENT_MIGRATION_VERSION) {
          // Fast path: nothing to migrate, and the id index is already on
          // disk — no day file is even parsed
          this.idIndex = new Map(Object.entries(saved.index)
            .filter(([id, date]) => typeof id === 'string' && id.length > 0
              && typeof date === 'string' && date.match(DATE_PATTERN) !== null));
          this.migrationCompleted = true;
          return undefined;
        }
        const pending = MIGRATIONS.filter((migration) => migration.version > storedVersion);
        return pending.reduce(
          (prev, migration) => prev.then(() => {
            if (onProgress) {
              onProgress(`Migrating logbook: ${migration.description}…`);
            }
            return migration.run(this);
          }),
          Promise.resolve(),
        )
          .then(() => {
            this.migrationCompleted = true;
            // Written once, after everything: the marker must never
            // describe a half-migrated storage
            return this._saveMigrationState();
          });
      });
  }

  /**
   * Migration v1 for pre-id entries: stamps a fresh UUID id on every
   * entry, backs up day files before rewriting them in place, builds the
   * in-memory id → date index and deduplicates entries that an
   * interrupted cross-day move left in two files (the earliest copy wins).
   * Idempotent: entries already carrying an id are kept, and once all
   * entries are stamped a re-run changes nothing.
   */
  _migrateEntryIds() {
    const seen = new Set();
    return this.listDates()
      .then((dates) => dates.sort())
      .then((dates) => dates.reduce(
        (prev, date) => prev.then(() => this._migrateDate(date, seen)),
        Promise.resolve(),
      ));
  }

  /**
   * Persist `.migration.json`: the current migration version plus the id
   * index, so the next startup takes the fast path. Writes are serialized
   * through a chain and land via rename (a torn file from a power cut
   * would parse as missing and cost one re-scan); failures are swallowed —
   * they cost at most a full migration re-run on the next start.
   */
  _saveMigrationState() {
    if (!this.migrationCompleted) {
      // Only a completed migration (or a loaded current-version state
      // file) may write the state file — otherwise a partial index could
      // pass for a fully migrated storage
      return Promise.resolve();
    }
    const saved = {
      version: CURRENT_MIGRATION_VERSION,
      index: Object.fromEntries(this.idIndex),
    };
    const path = join(this.dir, MIGRATION_STATE_FILE);
    const tmpPath = `${path}.tmp`;
    this.stateSaveChain = this.stateSaveChain
      .then(() => writeFile(tmpPath, JSON.stringify(saved), 'utf-8')
        .then(() => rename(tmpPath, path)))
      .catch(() => {});
    return this.stateSaveChain;
  }

  _migrateDate(date, seen) {
    // Under the date's write queue: writes landing while a migration is
    // running (triggers and v1 routes are live throughout) are ordered
    // against the rewrite instead of being clobbered by it
    return this._enqueue(date, () => this._getDateInternal(date)
      // Unreadable or invalid day file: leave it untouched rather than
      // rewriting it from a partially understood state.
      .catch(() => null)
      .then((data) => {
        if (!data) {
          return null;
        }
        let changed = false;
        const kept = [];
        data.forEach((source) => {
          const entry = { ...source };
          if (!entry.id || typeof entry.id !== 'string') {
            entry.id = randomUUID();
            changed = true;
          }
          if (seen.has(entry.id)) {
            // Duplicate of an entry already seen in an earlier day file
            // (interrupted cross-day move): keep a single copy.
            changed = true;
            return;
          }
          seen.add(entry.id);
          this.idIndex.set(entry.id, date);
          kept.push(entry);
        });
        if (!changed) {
          return null;
        }
        return this._backupAndRewrite(date, kept);
      }));
  }

  _backupAndRewrite(date, kept) {
    const backupDir = join(this.dir, MIGRATION_BACKUP_DIR);
    const backupPath = join(backupDir, `${date}.yml`);
    return mkdir(backupDir, { recursive: true })
      .catch(() => {})
      .then(() => access(backupPath))
      .catch(() => copyFile(this.getPath(date), backupPath))
      // Direct internal write: the migration task already runs under the
      // date's write queue, and writeDate would queue behind itself
      .then(() => this._writeDateInternal(date, kept));
  }

  prepareValidator() {
    if (this.validator) {
      return Promise.resolve(this.validator);
    }
    const v = new Validator();
    Object.keys(openAPI.components.schemas).forEach((name) => {
      const schema = {
        ...openAPI.components.schemas[name],
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        $id: `https://lille-oe.de/#Logbook-${name}`,
      };
      if (schema.$id === 'https://lille-oe.de/#Logbook-Log') {
        schema.items.$ref = 'https://lille-oe.de/#Logbook-Entry';
      }
      if (schema.$id === 'https://lille-oe.de/#Logbook-Entry' || schema.$id === 'https://lille-oe.de/#Logbook-Entry') {
        schema.properties.observations.$ref = 'https://lille-oe.de/#Logbook-Observations';
      }
      v.addSchema(schema);
    });
    this.validator = v;
    return Promise.resolve(v);
  }

  validateEntry(entry) {
    return this.prepareValidator()
      .then((v) => v.validate(entry, {
        $ref: 'https://lille-oe.de/#Logbook-Entry',
      }));
  }

  validateDate(data) {
    return this.prepareValidator()
      .then((v) => v.validate(data, {
        $ref: 'https://lille-oe.de/#Logbook-Log',
      }));
  }
}

// The version a storage must record in .migration.json for the fast
// startup path; exposed for tests and diagnostics
Log.MIGRATION_VERSION = CURRENT_MIGRATION_VERSION;

module.exports = Log;
