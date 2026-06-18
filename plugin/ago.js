/**
 * Resolve the POST /logs `ago` field — how many samples back in the state
 * buffer to snapshot — to a non-negative integer index, defaulting to 0 (the
 * most recent sample) when the field is missing or not a finite number.
 *
 * Without this, a request body with no `ago` reaches `buffer.get(undefined)`,
 * which throws `TypeError: Invalid start` and 500s the request once the state
 * buffer has filled.
 */
module.exports = function resolveAgo(rawAgo) {
  const n = Number(rawAgo);
  if (!Number.isFinite(n) || n < 0) {
    return 0;
  }
  return Math.floor(n);
};
