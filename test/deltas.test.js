const test = require('node:test');
const assert = require('node:assert');
const { createResourceNotifier, RESOURCE_TYPE } = require('../plugin/deltas');

function handleMessageStub() {
  const calls = [];
  return {
    calls,
    handleMessage(source, delta, version) {
      calls.push({ source, delta, version });
    },
  };
}

test('createResourceNotifier emits the resource delta for a write', () => {
  const app = handleMessageStub();
  const notify = createResourceNotifier(app, 'signalk-logbook', () => true);
  notify({
    id: '1b4e28ba-2fa1-11d2-883f-b9a761bde3fb',
    datetime: new Date('2026-06-11T08:00:00.000Z'),
    text: 'Departed',
    heading: 190,
    category: 'navigation',
  }, 'write');
  assert.strictEqual(app.calls.length, 1);
  const { source, delta, version } = app.calls[0];
  assert.strictEqual(source, 'signalk-logbook');
  assert.strictEqual(version, 2, 'resources must not enter the full model cache');
  const value = delta.updates[0].values[0];
  assert.strictEqual(value.path, `resources.${RESOURCE_TYPE}.1b4e28ba-2fa1-11d2-883f-b9a761bde3fb`);
  assert.strictEqual(value.value.text, 'Departed');
  assert.strictEqual(value.value.datetime, '2026-06-11T08:00:00.000Z', 'datetime normalized to ISO');
  assert.deepStrictEqual(
    value.value.telemetry.find((pv) => pv.path === 'navigation.headingTrue'),
    { path: 'navigation.headingTrue', value: 190 * (Math.PI / 180) },
    'value is the resource representation (SI pathvalues)',
  );
  assert.strictEqual(value.value.$source, 'signalk-logbook');
});

test('createResourceNotifier emits a null value on delete', () => {
  const app = handleMessageStub();
  const notify = createResourceNotifier(app, 'signalk-logbook', () => true);
  notify({ id: '1b4e28ba-2fa1-11d2-883f-b9a761bde3fb' }, 'delete');
  const value = app.calls[0].delta.updates[0].values[0];
  assert.strictEqual(value.path, `resources.${RESOURCE_TYPE}.1b4e28ba-2fa1-11d2-883f-b9a761bde3fb`);
  assert.strictEqual(value.value, null);
});

test('createResourceNotifier skips when the provider is not active', () => {
  const app = handleMessageStub();
  const notify = createResourceNotifier(app, 'signalk-logbook', () => false);
  notify({ id: '1b4e28ba-2fa1-11d2-883f-b9a761bde3fb', text: 'x' }, 'write');
  assert.strictEqual(app.calls.length, 0, 'no deltas without a registered provider');
});

test('createResourceNotifier swallows emission failures', () => {
  const app = {
    handleMessage() {
      throw new Error('boom');
    },
    error() {},
  };
  const notify = createResourceNotifier(app, 'signalk-logbook', () => true);
  assert.doesNotThrow(() => notify({ id: '1b4e28ba-2fa1-11d2-883f-b9a761bde3fb', text: 'x' }, 'write'));
});

test('createResourceNotifier skips entries without an id', () => {
  const app = handleMessageStub();
  const notify = createResourceNotifier(app, 'signalk-logbook', () => true);
  notify({ datetime: '2026-06-11T08:00:00.000Z', text: 'x' }, 'write');
  assert.strictEqual(app.calls.length, 0);
});
