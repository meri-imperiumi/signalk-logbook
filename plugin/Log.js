const { stat, readdir, readFile, writeFile } = require('node:fs/promises');
const { join, basename } = require('path');
const { parse, stringify } = require('yaml');

class Log {
  constructor(dir) {
    this.dir = dir;
  }

  listEntries() {
    return readdir(this.dir)
      .then((entries) => {
        const valid = entries.filter((e) => e.match(/^\d{4}-([0]\d|1[0-2])-([0-2]\d|3[01])\.yml$/));
        return valid.map((v) => basename(v, '.yml'));
      });
  }

  getEntry(date) {
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
      .then((content) => parse(content)); // TODO: Validate against schema?
  }

  writeEntry(date, entry) {
    if (!date.match(/^\d{4}-([0]\d|1[0-2])-([0-2]\d|3[01])$/)) {
      return Promise.reject(new Error('Invalid date format'));
    }
    const path = this.getPath(date);
    // TODO: Validate against schema
    const yaml = stringify(entry);
    return writeFile(path, yaml, 'utf-8');
  }

  appendEntry(date, data) {
    return this.getEntry(date)
      .catch(() => [])
      .then((entry) => {
        entry.push(data);
        // TODO: Sorting
        return this.writeEntry(date, entry);
      });
  }

  getPath(date) {
    const dateString = new Date(date).toISOString().substr(0, 10);
    return join(this.dir, `${dateString}.yml`);
  }
}

module.exports = Log;
