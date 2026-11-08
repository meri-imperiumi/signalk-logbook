/**
 * Pure view helpers for the chart plotter new-entry window: the field
 * vocabularies the form offers (mirroring the webapp's EntryEditor) and
 * the conversion from the form state to the resources API entry payload
 * (the same translation the webapp's draftToApiEntry performs, see
 * plugin/telemetry.js for the boundary contract).
 *
 * No DOM and no host calls, so they are unit-testable in Node.
 *
 * @file plotterext/view.js
 */

/** Categories offered, same list as the webapp's entry editor. */
export const CATEGORIES = ['navigation', 'engine', 'radio', 'maintenance'];

/**
 * Fix origins accepted on a manually entered position, stored inside the
 * position pathvalue's `source` member.
 */
export const FIX_TYPES = ['GPS', 'GNSS', 'Visual', 'Radar', 'Celestial', 'DR'];

/** Quick "minutes ago" choices, 0 = now. */
export const AGO_CHOICES = [0, 5, 10, 15];

/**
 * Douglas sea state scale, index = the code stored on observations.
 * The storage (and the webapp editor) carry the Douglas 0–9 code; the
 * API path environment.water.seaStateValue carries the numeric Beaufort
 * scale, mapped through the standard WMO correspondence.
 */
export const SEA_STATES = [
  'Glassy calm (0m)',
  'Rippled calm (0-0.1m)',
  'Smooth (0.1-0.5m)',
  'Slight (0.5-1.25m)',
  'Moderate (1.25-2.5m)',
  'Rough (2.5-4m)',
  'Very rough (4-6m)',
  'High (6-9m)',
  'Very high (9-14m)',
  'Phenomenal (14m+)',
];

/** Visibility descriptive codes, index = the code stored on observations. */
export const VISIBILITY = [
  'Dense fog (<45m)',
  'Thick fog (<180m)',
  'Fog (<360m)',
  'Moderate fog (<0.5NM)',
  'Thin fog (<1NM)',
  'Poor visibility (<2NM)',
  'Moderate visibility (<5NM)',
  'Good visibility (<10NM)',
  'Very good visibility (<30NM)',
  'Excellent visibility (>30NM)',
];

// WMO correlation between the Douglas sea state code (storage/form) and
// the Beaufort force (API), from plugin/telemetry.js.
const DOUGLAS_TO_BEAUFORT = [0, 1, 2, 3, 5, 6, 8, 9, 10, 12];

/**
 * Douglas sea state code to Beaufort force.
 *
 * @param {number} code - Douglas code 0–9
 * @returns {number|null} Beaufort force, or null when unset/out of range
 */
export function douglasToBeaufort(code) {
  const n = Math.round(Number(code));
  if (!Number.isFinite(n) || n < 0 || n >= DOUGLAS_TO_BEAUFORT.length) {
    return null;
  }
  return DOUGLAS_TO_BEAUFORT[n];
}

/**
 * Cloud coverage in oktas to the ratio the API path carries.
 *
 * @param {number} oktas - Whole oktas 0–8
 * @returns {number|null} Ratio 0–1, or null when unset/out of range
 */
export function oktasToRatio(oktas) {
  const n = Math.round(Number(oktas));
  if (!Number.isFinite(n) || n < 0 || n > 8) {
    return null;
  }
  return n / 8;
}

/**
 * Generic coded-observation guard: a whole number within [0, max].
 *
 * @param {number} code
 * @param {number} max
 * @returns {number|null}
 */
function observationCode(code, max) {
  const n = Math.round(Number(code));
  if (!Number.isFinite(n) || n < 0 || n > max) {
    return null;
  }
  return n;
}

/**
 * Resolves the entry datetime from the form's "when" selection: a
 * specific datetime-local string is parsed in the device's local time
 * (on a plotter that is ship time), a quick choice is minutes back from
 * `now`.
 *
 * @param {object} form
 * @param {Date} now
 * @returns {string} RFC 3339 datetime
 * @throws {Error} when the specific datetime is unparseable
 */
function resolveDatetime(form, now) {
  if (form.when === 'specific') {
    const parsed = new Date(form.datetime);
    if (Number.isNaN(parsed.getTime())) {
      throw new Error('Invalid date and time');
    }
    return parsed.toISOString();
  }
  const ago = Number(form.when);
  const minutes = Number.isFinite(ago) && ago >= 0 ? ago : 0;
  return new Date(now.getTime() - minutes * 60000).toISOString();
}

/**
 * Builds the navigation.position pathvalue from the form's manual
 * position, or null when the fields are empty or out of range. The fix
 * type rides inside the value as its `source` member.
 *
 * @param {object} form
 * @returns {object|null}
 */
function buildPosition(form) {
  // Blank fields are no position: Number('') coerces to 0 and would pass
  // the range check, stamping entries at 0°N 0°E — and the position
  // pathvalue's presence suppresses the provider's live-GPS enrichment,
  // so the boat would stay at null island instead of its actual fix.
  // Whitespace is trimmed the same way; an explicitly typed 0 still is
  // a position, same as the webapp editor.
  const latitudeText = typeof form.latitude === 'string' ? form.latitude.trim() : '';
  const longitudeText = typeof form.longitude === 'string' ? form.longitude.trim() : '';
  if (latitudeText === '' || longitudeText === '') {
    return null;
  }
  const latitude = Number(latitudeText);
  const longitude = Number(longitudeText);
  const valid = Number.isFinite(latitude) && latitude >= -90 && latitude <= 90
    && Number.isFinite(longitude) && longitude >= -180 && longitude <= 180;
  if (!valid) {
    return null;
  }
  const value = { latitude, longitude };
  if (FIX_TYPES.includes(form.fixType)) {
    value.source = form.fixType;
  }
  return value;
}

/**
 * Converts the form state into the resources API payload for POST
 * /signalk/v2/api/resources/logentries — the same shape the webapp's
 * entry editor submits: logbook fields at the top level, form-captured
 * observations as SI pathvalues the provider enriches further (position,
 * speeds, wind) when the telemetry array omits them.
 *
 * @param {object} form
 * @param {Date} [now]
 * @returns {object} API entry payload
 * @throws {Error} when the specific datetime is unparseable
 */
export function buildEntryPayload(form, now = new Date()) {
  const payload = {
    text: typeof form.text === 'string' ? form.text : '',
    category: CATEGORIES.includes(form.category) ? form.category : 'navigation',
    origin: 'manual',
    datetime: resolveDatetime(form, now),
  };
  const telemetry = [];
  if (payload.category === 'radio'
    && typeof form.vhf === 'string' && form.vhf.length >= 1 && form.vhf.length <= 3) {
    telemetry.push({ path: 'communication.vhf.channel', value: form.vhf });
  }
  if (payload.category === 'navigation') {
    const beaufort = douglasToBeaufort(form.seaState);
    if (beaufort !== null) {
      telemetry.push({ path: 'environment.water.seaStateValue', value: beaufort });
    }
    const ratio = oktasToRatio(form.cloudCoverage);
    if (ratio !== null) {
      telemetry.push({ path: 'environment.outside.cloudCover', value: ratio });
    }
    const visibility = observationCode(form.visibility, 9);
    if (visibility !== null) {
      telemetry.push({ path: 'environment.outside.visibility', value: visibility });
    }
    const position = buildPosition(form);
    if (position) {
      telemetry.push({ path: 'navigation.position', value: position });
    }
  }
  if (telemetry.length > 0) {
    payload.telemetry = telemetry;
  }
  return payload;
}
