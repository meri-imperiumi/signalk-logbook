const {
  stat,
  readdir,
  readFile,
  writeFile,
} = require('fs/promises');
const { join, basename } = require('path');
const { parse, stringify } = require('yaml');
const { Validator } = require('jsonschema');
const openAPI = require('../schema/openapi.json');

class Log {
  constructor(dir) {
    this.dir = dir;
    this.validator = null;
    this.queues = new Map(); // Tracks active promises per date to prevent race conditions
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
    if (!date.match(/^\d{4}-([0]\d|1[0-2])-([0-2]\d|3[01])$/)) {
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
    if (!date.match(/^\d{4}-([0]\d|1[0-2])-([0-2]\d|3[01])$/)) {
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
    const dateString = datetimeString.substr(0, 10);
    return this.getDate(dateString) // Uses public getDate, which handles queuing safely
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
        const normalized = {
          ...entry,
          datetime: new Date(entry.datetime),
        };
        const idx = dateData.findIndex((e) => e.datetime.toISOString() === datetimeString);
        const updatedDate = [...dateData];
        if (idx === -1) {
          updatedDate.push(normalized);
        } else {
          updatedDate[idx] = normalized;
        }
        return this._writeDateInternal(dateString, updatedDate);
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
        const normalized = {
          ...data,
          datetime: new Date(data.datetime),
        };
        d.push(normalized);
        return this._writeDateInternal(date, d);
      }));
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
        dateData.splice(entryIdx, 1);
        return this._writeDateInternal(dateString, dateData);
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
      return 0;
    });
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
