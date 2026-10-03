/**
 * Delta emission for log entries written outside the resources API —
 * triggers, hourly entries, notification entries, and the deprecated v1
 * routes. The server emits `resources.logentries.<id>` deltas itself for
 * writes routed through the registered resource provider (upsertEntry /
 * deleteEntryById), so the provider path must not emit; these internal
 * writes go straight to storage and would otherwise leave clients
 * subscribed to `resources.logentries` polling for automatic entries (see
 * meri-imperiumi/signalk-logbook#106 and the server resource provider
 * docs, "Delta Notifications for Internal Resource Changes").
 */
const { storageToApi } = require('./telemetry');

const RESOURCE_TYPE = 'logentries';

/**
 * Create a Log change listener that emits the resource delta for each
 * legacy write. `isActive` gates emission: deltas only make sense once
 * the plugin has actually registered the logentries resource provider —
 * on servers without a resources API (or with the type claimed elsewhere)
 * there is no `resources.logentries` subscription to serve, and older
 * servers might not honor the v2 flag that keeps resources out of the
 * full model cache.
 */
function createResourceNotifier(app, providerId, isActive) {
  return (entry, change) => {
    if (!isActive() || !entry || !entry.id) {
      return;
    }
    try {
      app.handleMessage(providerId, {
        updates: [
          {
            values: [
              {
                path: `resources.${RESOURCE_TYPE}.${entry.id}`,
                value: change === 'delete'
                  ? null
                  : {
                    ...storageToApi(entry),
                    $source: providerId,
                  },
              },
            ],
          },
        ],
      }, 2);
    } catch (err) {
      // Delta emission must never fail the write it observes
      if (typeof app.error === 'function') {
        app.error(`Failed to emit logentries delta: ${err.message}`);
      }
    }
  };
}

module.exports = {
  RESOURCE_TYPE,
  createResourceNotifier,
};
