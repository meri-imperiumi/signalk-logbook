// Client-side representation adapter between the Signal K v2 `logentries`
// resources API (Signal K paths, SI units, `telemetry` pathvalue array —
// schema/logentries.schema.json) and the nautical field shape the logbook
// UI components render and edit. The translation is the same one the
// plugin performs at its provider boundary, reused here so both sides of
// the wire agree.
//
// The entry's original SI telemetry array is carried along as `_telemetry`:
// it is the source of truth for display rendering (src/helpers/units.js
// converts it through the user's unit preferences) and for write-back, so
// editing an entry never degrades the stored precision, and display-unit
// conversion never leaks into what gets written.

const {
  apiToStorage,
  storageToApi,
} = require('../../plugin/telemetry');
const { DISPLAY_ONLY_FIELDS } = require('./units');

// Fields the UI adds for rendering/interaction that are never persisted
const UI_ONLY_FIELDS = ['point', 'date', 'ago', 'when', 'timeMode', '_telemetry'];

// Telemetry-mapped paths the entry editor can change; their pathvalues are
// rebuilt from the form fields on write. Every other pathvalue is written
// back verbatim from `_telemetry`.
const EDITABLE_PATHS = [
  'navigation.position',
  'environment.water.seaStateValue',
  'environment.outside.cloudCover',
  'environment.outside.visibility',
  'communication.vhf.channel',
];

// Convert an API entry into the UI's nautical shape. Cloud cover is
// rounded to whole oktas for the slider, and a single engine instance is
// mirrored to the scalar `engine.hours` the existing UI rendering expects.
// The original SI telemetry is kept on `_telemetry` for display and
// write-back.
function apiToUiEntry(apiEntry) {
  const entry = apiToStorage(apiEntry);
  entry._telemetry = (apiEntry.telemetry || []).map((pv) => ({ ...pv }));
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

// Rebuild the editable pathvalues from the current form fields. Values
// arrive in the nautical/code shapes the editor uses and convert back to
// the API representation here.
function editablePathvalues(uiEntry) {
  const miniEntry = {};
  if (uiEntry.position) {
    miniEntry.position = uiEntry.position;
  }
  if (uiEntry.observations) {
    miniEntry.observations = uiEntry.observations;
  }
  if (uiEntry.vhf) {
    miniEntry.vhf = uiEntry.vhf;
  }
  // storageToApi converts the storage shapes back into pathvalues
  return (storageToApi(miniEntry).telemetry || []);
}

// Convert a UI entry into the API representation for writing. The
// payload's telemetry comes from the entry's original SI pathvalues —
// preserving full precision — overlaid with the fields the editor can
// change. Display-only converted fields are never written back.
//
// `adoptAuthor` (the logged-in username) adopts an authorless entry on
// edit: entries written without an author display as "auto", and the
// v1 routes this UI replaces set the stored author to the editing user
// on exactly that condition (`if (author && !entry.author)`). Entries
// that already carry an author keep it — editing someone else's line
// must not claim authorship — and with no logged-in user nothing is
// invented.
function uiEntryToApi(uiEntry, adoptAuthor) {
  const api = {};
  Object.keys(uiEntry).forEach((key) => {
    if (UI_ONLY_FIELDS.includes(key) || DISPLAY_ONLY_FIELDS.includes(key)) {
      return;
    }
    if (key === 'telemetry') {
      return;
    }
    api[key] = uiEntry[key];
  });

  const original = Array.isArray(uiEntry._telemetry) ? uiEntry._telemetry : [];
  const kept = original.filter((pv) => pv && !EDITABLE_PATHS.includes(pv.path));

  const telemetry = [...kept, ...editablePathvalues(uiEntry)];
  if (telemetry.length > 0) {
    api.telemetry = telemetry;
  }
  if (!api.author && adoptAuthor) {
    api.author = adoptAuthor;
  }
  return api;
}

// Convert a new-entry draft (the EntryEditor save payload) into an API
// entry for POST: an omitted datetime is resolved from the draft's
// `ago` (minutes back from now, 0 = now), the origin is manual —
// the resources API defaults to 'agent', which is for other writers —
// and the logged-in username is stamped as author. The resources API
// carries no request context, so without this the entry would store
// authorless where the v1 routes filled in the authenticated user.
function draftToApiEntry(draft, now, author) {
  const apiEntry = uiEntryToApi(draft);
  if (!apiEntry.datetime) {
    const agoMinutes = Number.isFinite(Number(draft.ago)) ? Number(draft.ago) : 0;
    apiEntry.datetime = new Date((now || new Date()).getTime() - agoMinutes * 60000).toISOString();
  }
  if (apiEntry.origin === undefined) {
    apiEntry.origin = 'manual';
  }
  if (apiEntry.author === undefined && author) {
    apiEntry.author = author;
  }
  return apiEntry;
}

module.exports = {
  EDITABLE_PATHS,
  UI_ONLY_FIELDS,
  apiToUiEntry,
  uiEntryToApi,
  draftToApiEntry,
};
