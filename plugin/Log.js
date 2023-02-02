const {
  stat,
  readdir,
  readFile,
  writeFile,
} = require('node:fs/promises');
const { join, basename } = require('path');
const { parse, stringify } = require('yaml');

class Log {
  constructor(dir) {
    this.dir = dir;
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
      .then((data) => {
        const normalized = data.map((entry) => ({
          ...entry,
          datetime: new Date(entry.datetime),
        }));
        if (!Log.validate(normalized)) {
          return Promise.reject(new Error('Invalid log structure'));
        }
        return normalized;
      });
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
    const yaml = stringify(data);
    return writeFile(path, yaml, 'utf-8');
  }

  writeEntry(entry) {
    const datetimeString = entry.datetime.toISOString();
    const dateString = datetimeString.substr(0, 10);
    return this.getDate(dateString)
      .then((date) => {
        const idx = date.findIndex((e) => e.datetime.toISOString() === datetimeString);
        if (idx === -1) {
          // TODO: Would it be better to fail here?
          return this.appendEntry(dateString, entry);
        }
        const updatedDate = [...date];
        updatedDate[idx] = entry;
        return this.writeDate(dateString, updatedDate);
      });
  }

  appendEntry(date, data) {
    return this.getDate(date)
      .catch(() => [])
      .then((d) => {
        d.push(data);
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

  static validate() {
    // TODO: Validate against schema?
    return true;
  }
}

module.exports = Log;
