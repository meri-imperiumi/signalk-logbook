// Date-range filtering for the logbook, per signalk-logbook#40.
//
// A filter is either a quick range preset, mirroring the VRM quick
// ranges, or a custom from–to span:
// - { preset: '2d' | '7d' | '30d' | '90d' | '6m' }
// - { from: 'YYYY-MM-DD', to: 'YYYY-MM-DD' }
//
// Custom range dates are display-timezone calendar dates; the fetch
// window derived from them still resolves to UTC, as storage stays UTC.

const { DateTime } = require('luxon');

const QUICK_RANGES = [
  { key: '2d', label: 'Last 2 days' },
  { key: '7d', label: 'Last 7 days' },
  { key: '30d', label: 'Last 30 days' },
  { key: '90d', label: 'Last 90 days' },
  { key: '6m', label: 'Last 6 months' },
];

const DEFAULT_FILTER = { preset: '7d' };

function presetKeyValid(key) {
  return QUICK_RANGES.some((range) => range.key === key);
}

function isCustomFilter(filter) {
  return Boolean(filter && filter.from && filter.to);
}

// Map a legacy day count onto the quick range it falls into
function daysToPreset(days) {
  if (days <= 2) {
    return { preset: '2d' };
  }
  if (days <= 7) {
    return { preset: '7d' };
  }
  if (days <= 30) {
    return { preset: '30d' };
  }
  if (days <= 90) {
    return { preset: '90d' };
  }
  return { preset: '6m' };
}

// Accepts also the persisted legacy shape { daysToShow: N }, mapping a
// day count onto the quick range it falls into. The count may arrive as
// a string or a bare scalar: the old editor kept whatever the
// applicationData API returned in state, so numbers were not guaranteed.
function normalizeFilter(raw) {
  if (raw === null || raw === undefined) {
    return { ...DEFAULT_FILTER };
  }
  if (isCustomFilter(raw)) {
    return { from: raw.from, to: raw.to };
  }
  if (raw.preset && presetKeyValid(raw.preset)) {
    return { preset: raw.preset };
  }
  if (typeof raw === 'string' && presetKeyValid(raw)) {
    return { preset: raw };
  }
  let count = raw;
  if (typeof raw === 'object') {
    count = raw.daysToShow !== undefined ? raw.daysToShow : raw.days;
  }
  const days = Number(count);
  if (Number.isFinite(days) && days > 0) {
    return daysToPreset(days);
  }
  return { ...DEFAULT_FILTER };
}

// Human-readable designation for the Metadata bar: the preset label,
// or the custom span as ISO dates
function filterLabel(filter) {
  if (isCustomFilter(filter)) {
    return `${filter.from} – ${filter.to}`;
  }
  const preset = QUICK_RANGES.find((range) => range.key === filter.preset)
    || QUICK_RANGES.find((range) => range.key === DEFAULT_FILTER.preset);
  return preset.label;
}

// UTC ISO bounds for the entries query, following the display timezone:
// quick ranges start at local midnight the day the window opens and run
// to the end of the current local day; custom spans cover whole local
// days from start of `from` to end of `to`
function filterWindow(filter, now, zone) {
  const nowDt = DateTime.fromJSDate(now).setZone(zone);
  if (isCustomFilter(filter)) {
    const from = DateTime.fromISO(filter.from, { zone }).startOf('day');
    const to = DateTime.fromISO(filter.to, { zone }).endOf('day');
    if (!from.isValid || !to.isValid) {
      return null;
    }
    return {
      from: from.toUTC().toISO(),
      to: to.toUTC().toISO(),
    };
  }
  const preset = QUICK_RANGES.find((range) => range.key === filter.preset)
    || QUICK_RANGES.find((range) => range.key === DEFAULT_FILTER.preset);
  const match = preset.key.match(/^(\d+)(d|m)$/);
  const amount = parseInt(match[1], 10);
  const from = match[2] === 'm'
    ? nowDt.minus({ months: amount }).startOf('day')
    : nowDt.minus({ days: amount - 1 }).startOf('day');
  return {
    from: from.toUTC().toISO(),
    to: nowDt.endOf('day').toUTC().toISO(),
  };
}

module.exports = {
  QUICK_RANGES,
  DEFAULT_FILTER,
  isCustomFilter,
  normalizeFilter,
  filterLabel,
  filterWindow,
};
