const {
  stat,
  readdir,
  readFile,
  writeFile,
} = require('node:fs/promises');
const { join, resolve, basename } = require('path');
const { parse, stringify } = require('yaml');
const { Validator } = require('jsonschema');

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
        return entry;
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
    const datetimeString = entry.datetime.toISOString();
    const dateString = datetimeString.substr(0, 10);
    return this.validateEntry(entry)
      .then((valid) => {
        if (valid.errors.length > 0) {
          return Promise.reject(valid.errors[0]);
        }
        return this.getDate().catch(() => []);
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
    const schemaDir = resolve(__dirname, '../schema');
    return readFile(`${schemaDir}/entry.json`)
      .then((entrySchema) => {
        v.addSchema(JSON.parse(entrySchema));
        return readFile(`${schemaDir}/log.json`);
      })
      .then((logSchema) => {
        v.addSchema(JSON.parse(logSchema));
        this.validator = v;
        return v;
      });
  }

  validateEntry(entry) {
    return this.prepareValidator()
      .then((v) => v.validate(entry, {
        $ref: 'https://lille-oe.de/#log-entry',
      }));
  }

  validateDate(data) {
    return this.prepareValidator()
      .then((v) => v.validate(data, {
        $ref: 'https://lille-oe.de/#log-date',
      }));
  }
}

module.exports = Log;
