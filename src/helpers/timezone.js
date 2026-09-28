// Display timezone handling for the logbook. Entries are always stored
// in UTC; these helpers only decide how they are rendered and which
// days the logbook shows.
//
// Two settings are supported:
// - 'UTC': entries are shown in UTC, timestamps suffixed with an
//   explicit Z
// - 'ship': entries are shown in ship's time without a timezone
//   specifier. Ship's time is the fixed offset published by
//   signalk-ships-time at environment.time.timezoneOffset in the
//   (-)hhmm encoding, e.g. 1300 → UTC+13.

const { DateTime } = require('luxon');

// Convert a (-)hhmm offset into a zero-padded fixed-offset zone string
// understood by both luxon and Intl: 1300 → '+13:00', -930 → '-09:30'
function offsetToZone(hhmm) {
  const sign = hhmm < 0 ? '-' : '+';
  const abs = Math.abs(hhmm);
  const hours = String(Math.floor(abs / 100)).padStart(2, '0');
  const minutes = String(abs % 100).padStart(2, '0');
  return `${sign}${hours}:${minutes}`;
}

// Resolve the displayTimeZone setting into a concrete zone string.
// Ship's time without a received offset — and any unknown setting,
// such as IANA zones from before only these two were offered — falls
// back to UTC.
function displayZone(setting, timezoneOffset) {
  if (setting === 'ship' && Number.isFinite(timezoneOffset)) {
    return offsetToZone(timezoneOffset);
  }
  return 'UTC';
}

// Timestamp per the Signal K visuals spec: ship's time carries no
// timezone specifier, UTC is explicitly suffixed with Z. Dates use
// YYYY-MM-DD.
function formatTimestamp(date, zone) {
  const dt = DateTime.fromJSDate(date).setZone(zone);
  return `${dt.toFormat('yyyy-MM-dd HH:mm:ss')}${zone === 'UTC' ? 'Z' : ''}`;
}

// Earliest UTC day key to load when showing `days` days of entries
// ending today in `zone`. The log day files are keyed by UTC dates
// (storage remains UTC); the window itself follows the display timezone.
function showFromKey(now, zone, days) {
  return DateTime.fromJSDate(now)
    .setZone(zone)
    .minus({ days: days - 1 })
    .startOf('day')
    .toUTC()
    .toISODate();
}

module.exports = {
  offsetToZone,
  displayZone,
  formatTimestamp,
  showFromKey,
};
