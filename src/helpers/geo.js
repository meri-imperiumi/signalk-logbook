// Antimeridian handling for the log map's track and markers. Signal K
// positions carry longitudes wrapped to [-180, 180], so a vessel sailing
// across the 180th meridian produces consecutive track points that jump,
// e.g. from 179.9°E to 179.9°W. Drawing those raw values as line segments
// makes the track wrap the long way around the planet, and bounds computed
// from them span the whole world instead of the actual track.
//
// The fix is the same one MapLibre applies to antimeridian-crossing bounds
// itself (LngLatBounds#adjustAntiMeridian): continue longitudes past ±180
// into unwrapped space (179.9°E → 180.1°E) and let the renderer's world
// copies draw across the seam. MapLibre projects longitudes linearly
// without wrapping, so coordinates beyond ±180° both render and fit
// correctly across the date line.

// Shift a longitude by whole revolutions until it sits within half a
// revolution of the reference, e.g. -179.7°W becomes 180.3°E next to a
// 179.9°E reference. Used to keep entry markers on the same world copy as
// the unwrapped track.
function unwrapLongitude(longitude, reference) {
  let lon = longitude;
  while (lon - reference > 180) {
    lon -= 360;
  }
  while (lon - reference < -180) {
    lon += 360;
  }
  return lon;
}

// Unwrap a chronologically ordered point list ({lat, lon}) into continuous
// longitude space: each point shifts by whole revolutions to stay within
// half a revolution of its predecessor, anchored on the first point's raw
// value. A point with a non-finite longitude passes through untouched and
// is skipped when unwrapping successors, so one broken value cannot derail
// the rest of the track.
function unwrapTrackPoints(points) {
  let previous = null;
  return points.map((point) => {
    const { lon } = point;
    if (!Number.isFinite(lon)) {
      return point;
    }
    const unwrapped = previous === null ? lon : unwrapLongitude(lon, previous);
    previous = unwrapped;
    return { ...point, lon: unwrapped };
  });
}

module.exports = {
  unwrapLongitude,
  unwrapTrackPoints,
};
