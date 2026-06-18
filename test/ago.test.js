const test = require('node:test');
const assert = require('node:assert');
const resolveAgo = require('../plugin/ago');

test('missing ago defaults to 0 (regression: buffer.get(undefined) 500d the request)', () => {
  assert.strictEqual(resolveAgo(undefined), 0);
});

test('a valid ago is preserved', () => {
  assert.strictEqual(resolveAgo(0), 0);
  assert.strictEqual(resolveAgo(3), 3);
});

test('numeric strings are coerced', () => {
  assert.strictEqual(resolveAgo('2'), 2);
});

test('negative, NaN, null and non-numeric fall back to 0', () => {
  assert.strictEqual(resolveAgo(-1), 0);
  assert.strictEqual(resolveAgo('abc'), 0);
  assert.strictEqual(resolveAgo(null), 0);
});

test('fractional ago floors to an integer buffer index', () => {
  assert.strictEqual(resolveAgo(2.9), 2);
});
