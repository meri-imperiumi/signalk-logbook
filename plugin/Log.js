const {
  stat,
  readdir,
  readFile,
  writeFile,
} = require('node:fs/promises');
const { join, basename } = require('path');
const { parse, stringify } = require('yaml');
const { Validator } = require('jsonschema');
const openAPI = require('../schema/openapi.json');

class Log {
  constructor(dir) {
    this.dir = dir;
    this.validator = null;
  }

  listDates() {
    return readdir(this.dir)
      .then((dates) => {
        const valid = dates.filter((e) => e.match(/^\d{4}-([0]\d|1[0-2])-([0-2]\d|3[01])\.yml$/));
        return valid.map((v) => basename(v, '.yml'));
      });
  }

  getDate(date) {
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
      .then((content) => parse(content))
      .then((data) => this.validateDate(data)
        .then((valid) => {
          if (valid.errors.length > 0) {
            return Promise.reject(valid.errors[0]);
          }
          return data.map((entry) => ({
            ...entry,
            category: entry.category || 'navigation',
            datetime: new Date(entry.datetime),
          }));
        }));
  }

  getEntry(datetime) {
    const datetimeString = new Date(datetime).toISOString();
    const dateString = datetimeString.substr(0, 10);
    return this.getDate(dateString)
      .then((date) => {
        const entry = date.find((e) => e.datetime.toISOString() === datetimeString);
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
    if (!date.match(/^\d{4}-([0]\d|1[0-2])-([0-2]\d|3[01])$/)) {
      return Promise.reject(new Error('Invalid date format'));
    }
    const path = this.getPath(date);
    // TODO: Validate against schema
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

  writeEntry(entry) {
    const datetimeString = new Date(entry.datetime).toISOString();
    const dateString = datetimeString.substr(0, 10);
    return this.validateEntry(entry)
      .then((valid) => {
        if (valid.errors.length > 0) {
          return Promise.reject(valid.errors[0]);
        }
        return this.getDate(dateString).catch(() => []);
      })
      .then((date) => {
        const normalized = {
          ...entry,
          datetime: new Date(entry.datetime),
        };
        const idx = date.findIndex((e) => e.datetime.toISOString() === datetimeString);
        const updatedDate = [...date];
        if (idx === -1) {
          // TODO: Would it be better to fail here?
          updatedDate.push(normalized);
        } else {
          updatedDate[idx] = normalized;
        }
        return this.writeDate(dateString, updatedDate);
      });
  }

  appendEntry(date, data) {
    return this.validateEntry(data)
      .then((valid) => {
        if (valid.errors.length > 0) {
          return Promise.reject(valid.errors[0]);
        }
        return this.getDate(date).catch(() => []);
      })
      .then((d) => {
        const normalized = {
          ...data,
          datetime: new Date(data.datetime),
        };
        d.push(normalized);
        return this.writeDate(date, d);
      });
  }

  deleteEntry(datetimeString) {
    const dateString = datetimeString.substr(0, 10);
    return this.getDate(dateString)
      .then((date) => {
        const entryIdx = date.findIndex((e) => e.datetime.toISOString() === datetimeString);
        if (entryIdx === -1) {
          const err = new Error(`Entry ${datetimeString} not found`);
          err.code = 'ENOENT';
          return Promise.reject(err);
        }
        date.splice(entryIdx, 1);
        return this.writeDate(dateString, date);
      });
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
        // TODO: Proper dereferencing
        schema.items.$ref = 'https://lille-oe.de/#Logbook-Entry';
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
