/**
 * Chart plotter extension for writing log entries (docs on the
 * `plotterExtensions` resource type: consumed by Freeboard-SK and other
 * chart plotters). A toolbar button opens a small window with the
 * new-entry form — the same fields as the webapp's entry editor, sized
 * for writing a line from the chart without switching apps. Pages are
 * served from `public/plotterext/` (copied from `public_src/plotterext/`
 * at build time) and talk to this plugin's reads through the resources
 * API on the user's own session.
 */
const pkg = require('../package.json');

/** Where the server serves `public/` (the package is a `signalk-webapp`). */
const PUBLIC_BASE = `/${pkg.name}`;

/**
 * The manifest served as the plugin's `plotterExtensions` resource. The
 * form needs no Signal K stream of its own — entries dated to "now" get
 * their telemetry enriched by the provider — so only the button and the
 * iframe panel are required; floating windows and night mode are used
 * where the host has them.
 */
const PLOTTER_EXTENSION = {
  name: 'Logbook',
  description: 'Write a logbook entry from the chart: remarks, category, observations and position.',
  version: pkg.version,
  apiVersion: '1',
  requires: ['buttons', 'panels.iframe'],
  optional: ['windows', 'nightMode'],
  buttons: [
    {
      id: 'logbook-new-entry',
      title: 'Log entry',
      slot: 'mapToolbar',
      icon: 'edit_note',
      action: {
        type: 'toggleWindow',
        panel: 'logbook-new-entry',
        geometry: { anchor: 'top-right', width: 340, height: 560 },
        restoreKey: 'logbook-new-entry',
      },
    },
  ],
  panels: [
    {
      id: 'logbook-new-entry',
      title: 'Log entry',
      type: 'iframe',
      url: `${PUBLIC_BASE}/plotterext/newentry.html`,
    },
  ],
};

/**
 * Create the read-only provider methods serving the manifest. Discovery
 * is gated by `isRunning` so a stopped plugin disappears from the
 * plotter's extension lists with no stale button: the registration
 * itself cannot be undone (the server has no un-register API, the same
 * as the logentries provider), but an empty listing is equivalent.
 *
 * @param {object} options
 * @param {string} options.providerId - Key the manifest is served under
 * @param {() => boolean} options.isRunning - Whether the plugin is started
 * @returns {object} ResourceProviderMethods for type `plotterExtensions`
 */
function createPlotterExtensionProvider({ providerId, isRunning }) {
  return {
    listResources: async () => (isRunning() ? { [providerId]: PLOTTER_EXTENSION } : {}),
    getResource: async (id) => {
      if (!isRunning() || id !== providerId) {
        throw new Error(`No such plotterExtensions resource: ${id}`);
      }
      return PLOTTER_EXTENSION;
    },
    setResource: async () => {
      throw new Error(`${providerId} is a read-only provider`);
    },
    deleteResource: async () => {
      throw new Error(`${providerId} is a read-only provider`);
    },
  };
}

module.exports = {
  PLOTTER_EXTENSION,
  createPlotterExtensionProvider,
};
