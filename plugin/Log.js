const {
  stat,
  readdir,
  readFile,
  writeFile,
  mkdir,
  copyFile,
  access,
} = require('fs/promises');
const { join, basename } = require('path');
const { randomUUID } = require('crypto');
const { parse, stringify } = require('yaml');
const { Validator } = require('jsonschema');
const openAPI = require('../schema/openapi.json');

const DATE_PATTERN = /^\d{4}-([0]\d|1[0-2])-([0-2]\d|3[01])$/;
const MIGRATION_BACKUP_DIR = 'id-migration-backup';

class Log {
  constructor(dir) {
    this.dir = dir;
    this.validator = null;
    this.queues = new Map(); // Tracks active promises per date to prevent race conditions
    // In-memory index of entry id → date string. Built by the startup
    // migration scan and maintained on writes, so id-addressed operations
    // find the right day file without scanning every file.
    this.idIndex = new Map();
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
   * One-time startup migration for pre-id entries: stamps a fresh UUID id
   * on every entry, backs up day files before rewriting them in place,
   * builds the in-memory id → date index and deduplicates entries that an
   * interrupted cross-day move left in two files (the earliest copy wins).
   * Idempotent: entries already carrying an id are kept, and once all
   * entries are stamped a re-run changes nothing.
   */
  migrate() {
    const seen = new Set();
    return this.listDates()
      .then((dates) => dates.sort())
      .then((dates) => dates.reduce(
        (prev, date) => prev.then(() => this._migrateDate(date, seen)),
        Promise.resolve(),
      ));
  }

  _migrateDate(date, seen) {
    return this._getDateInternal(date)
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
      });
  }

  _backupAndRewrite(date, kept) {
    const backupDir = join(this.dir, MIGRATION_BACKUP_DIR);
    const backupPath = join(backupDir, `${date}.yml`);
    return mkdir(backupDir, { recursive: true })
      .catch(() => {})
      .then(() => access(backupPath))
      .catch(() => copyFile(this.getPath(date), backupPath))
      .then(() => this.writeDate(date, kept));
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

module.exports = Log;
