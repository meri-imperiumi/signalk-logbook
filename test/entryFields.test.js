const test = require('node:test');
const assert = require('node:assert');
const applyBodyFields = require('../plugin/entryFields');

test('category defaults to navigation and is overridable from the body', () => {
  assert.strictEqual(applyBodyFields({}, {}).category, 'navigation');
  assert.strictEqual(applyBodyFields({}, { category: 'radio' }).category, 'radio');
});

test('body observations merge with auto-captured ones instead of replacing', () => {
  const data = { observations: { seaState: 3 } };
  const entry = applyBodyFields(data, { observations: { visibility: 4 } });
  assert.deepStrictEqual(entry.observations, { seaState: 3, visibility: 4 });
});

test('body observations win over auto-captured values on conflict', () => {
  const data = { observations: { seaState: 3 } };
  const entry = applyBodyFields(data, { observations: { seaState: 5 } });
  assert.strictEqual(entry.observations.seaState, 5);
});

test('vhf is accepted from the body when it fits the schema constraint', () => {
  assert.strictEqual(applyBodyFields({}, { vhf: '70' }).vhf, '70');
  assert.strictEqual(applyBodyFields({}, { vhf: '9' }).vhf, '9');
});

test('invalid vhf values are ignored rather than failing entry validation', () => {
  assert.strictEqual(applyBodyFields({}, { vhf: '700' }).vhf, undefined);
  assert.strictEqual(applyBodyFields({}, { vhf: '' }).vhf, undefined);
  assert.strictEqual(applyBodyFields({}, { vhf: 70 }).vhf, undefined);
});

test('manual position from the body is copied', () => {
  const entry = applyBodyFields({}, { position: { latitude: 48.7, longitude: -123.0 } });
  assert.deepStrictEqual(entry.position, { latitude: 48.7, longitude: -123.0 });
});

test('state-derived fields pass through untouched', () => {
  const entry = applyBodyFields({ heading: 190, vhf: '16' }, {});
  assert.strictEqual(entry.heading, 190);
  assert.strictEqual(entry.vhf, '16'); // auto-captured channel kept when body has none
});

test('body author overrides the cookie-derived one (delegation)', () => {
  assert.strictEqual(applyBodyFields({ author: 'token-id' }, { author: 'Bryan' }).author, 'Bryan');
  assert.strictEqual(applyBodyFields({ author: 'token-id' }, {}).author, 'token-id');
});

test('non-string or empty body author is ignored', () => {
  // entry with NO pre-existing author: bad body.author must not produce one
  assert.strictEqual(applyBodyFields({}, { author: '' }).author, undefined);
  assert.strictEqual(applyBodyFields({}, { author: 42 }).author, undefined);
  // pre-existing author preserved when body.author is bad
  assert.strictEqual(applyBodyFields({ author: 'a' }, { author: '' }).author, 'a');
  assert.strictEqual(applyBodyFields({ author: 'a' }, { author: 42 }).author, 'a');
});

test('body origin is accepted when valid, ignored otherwise', () => {
  assert.strictEqual(applyBodyFields({ origin: 'manual' }, { origin: 'agent' }).origin, 'agent');
  assert.strictEqual(applyBodyFields({ origin: 'manual' }, { origin: 'bogus' }).origin, 'manual');
  assert.strictEqual(applyBodyFields({ origin: 'manual' }, {}).origin, 'manual');
  assert.strictEqual(applyBodyFields({}, { origin: 'bogus' }).origin, undefined);
});
