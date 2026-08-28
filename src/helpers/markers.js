// Entry marker colors by logbook category, shared by the raster (pigeon-maps)
// and vector (MapLibre) map renderers so entries look the same on both.
function entryMarkerColor(category) {
  if (category === 'engine') {
    return '#ed1b2f';
  }
  if (category === 'radio') {
    return '#00ae9d';
  }
  return '#009bdb';
}

module.exports = {
  entryMarkerColor,
};
