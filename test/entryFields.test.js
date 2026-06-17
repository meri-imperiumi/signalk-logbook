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
