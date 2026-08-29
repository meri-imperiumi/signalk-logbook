const test = require('node:test');
const assert = require('node:assert');
const { tabFromHash, hashForTab } = require('../src/helpers/tabs');

test('known tabs resolve from a bare hash', () => {
  assert.strictEqual(tabFromHash('#timeline'), 'timeline');
  assert.strictEqual(tabFromHash('#book'), 'book');
  assert.strictEqual(tabFromHash('#map'), 'map');
});

test('empty or unknown hashes fall back to timeline', () => {
  assert.strictEqual(tabFromHash(''), 'timeline');
  assert.strictEqual(tabFromHash('#nonsense'), 'timeline');
});

test('host route hashes keep the tab in the query string', () => {
  assert.strictEqual(tabFromHash('#/webapps/signalk-logbook?logbook-tab=map'), 'map');
  assert.strictEqual(tabFromHash('#/webapps/signalk-logbook?logbook-tab=book&other=1'), 'book');
  assert.strictEqual(tabFromHash('#/webapps/signalk-logbook'), 'timeline');
  assert.strictEqual(tabFromHash('#/webapps/signalk-logbook?logbook-tab=junk'), 'timeline');
});

test('hashForTab preserves the host route and other params', () => {
  assert.strictEqual(hashForTab('book', '#/webapps/signalk-logbook'), '#/webapps/signalk-logbook?logbook-tab=book');
  assert.strictEqual(hashForTab('map', '#/webapps/signalk-logbook?logbook-tab=book'), '#/webapps/signalk-logbook?logbook-tab=map');
  assert.strictEqual(hashForTab('map', '#/route?other=1'), '#/route?other=1&logbook-tab=map');
});

test('hashForTab uses the bare form when the hash is not a route', () => {
  assert.strictEqual(hashForTab('map', '#timeline'), '#map');
  assert.strictEqual(hashForTab('map', ''), '#map');
});
