// Entry marker colors by logbook category, shared by the log map's entry
// markers (ChartMap) and the entry forms so entries look the same in both.
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
