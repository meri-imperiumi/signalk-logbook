// Client-side representation adapter between the Signal K v2 `logentries`
// resources API (Signal K paths, SI units, `telemetry` pathvalue array —
// schema/logentries.schema.json) and the nautical field shape the logbook
// UI components render and edit (position, heading, speed, observations…).
// The translation is the same one the plugin performs at its provider
// boundary, reused here so both sides of the wire agree.

const { apiToStorage, storageToApi } = require('../../plugin/telemetry');

// Fields the UI adds for rendering/interaction that are never persisted
const UI_ONLY_FIELDS = ['point', 'date', 'ago', 'when', 'timeMode'];

// Convert an API entry into the UI's nautical shape, with two display
// conveniences on top of the plain translation: cloud cover is rounded to
// whole oktas for the slider, and a single engine instance is mirrored to
// the scalar `engine.hours` the existing UI rendering expects.
function apiToUiEntry(apiEntry) {
  const entry = apiToStorage(apiEntry);
  if (entry.observations
    && entry.observations.cloudCoverage !== undefined
    && entry.observations.cloudCoverage !== null) {
    entry.observations.cloudCoverage = Math.round(Number(entry.observations.cloudCoverage));
  }
  if (entry.engine && entry.engine.engines && Object.keys(entry.engine.engines).length === 1) {
    entry.engine.hours = entry.engine.engines[Object.keys(entry.engine.engines)[0]].hours;
  }
  return entry;
}

// Convert a UI entry into the API representation for writing. UI-only
// fields are stripped so they never persist through the open content model.
function uiEntryToApi(uiEntry) {
  const sanitized = {};
  Object.keys(uiEntry).forEach((key) => {
    if (!UI_ONLY_FIELDS.includes(key)) {
      sanitized[key] = uiEntry[key];
    }
  });
  return storageToApi(sanitized);
}

// Convert a new-entry draft (the EntryEditor save payload) into an API
// entry for POST: an omitted datetime is resolved from the draft's
// `ago` (minutes back from now, 0 = now), and the origin is manual —
// the resources API defaults to 'agent', which is for other writers.
function draftToApiEntry(draft, now) {
  const apiEntry = uiEntryToApi(draft);
  if (!apiEntry.datetime) {
    const agoMinutes = Number.isFinite(Number(draft.ago)) ? Number(draft.ago) : 0;
    apiEntry.datetime = new Date((now || new Date()).getTime() - agoMinutes * 60000).toISOString();
  }
  if (apiEntry.origin === undefined) {
    apiEntry.origin = 'manual';
  }
  return apiEntry;
}

module.exports = {
  apiToUiEntry,
  uiEntryToApi,
  draftToApiEntry,
};
