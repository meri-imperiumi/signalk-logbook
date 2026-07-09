// Tile-layer helpers for the log Map. SignalK exposes configured charts at
// `resources/charts`; we turn the tile charts into pigeon-maps providers so the
// map shows whatever the user already set up (offline MBTiles, ENCs, a
// referer-tolerant proxy…) instead of hardcoding OSM's public tiles, which now
// 403 for referer-less self-hosted setups (issue #76).

// Backward-compatible default when no tile charts are configured.
const DEFAULT_LAYER = {
  identifier: 'osm',
  name: 'OpenStreetMap',
  url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  minZoom: 0,
  maxZoom: 19,
};

// Normalize a SignalK `resources/charts` object into the tile layers we can
// render. Charts without a `tilemapUrl` (WMS, S-57, plain PDFs…) are dropped.
function parseChartLayers(resource) {
  if (!resource || typeof resource !== 'object') {
    return [];
  }
  return Object.keys(resource)
    .map((key) => {
      const chart = resource[key];
      if (!chart || !chart.tilemapUrl) {
        return null;
      }
      return {
        identifier: chart.identifier || key,
        name: chart.name || chart.identifier || key,
        url: chart.tilemapUrl,
        minZoom: typeof chart.minzoom === 'number' ? chart.minzoom : 0,
        maxZoom: typeof chart.maxzoom === 'number' ? chart.maxzoom : 19,
      };
    })
    .filter((layer) => layer !== null)
    .sort((a, b) => a.name.localeCompare(b.name));
}

// Configured tile layers, or a single sane default when none are set up.
function chartLayersWithFallback(resource) {
  const layers = parseChartLayers(resource);
  return layers.length ? layers : [DEFAULT_LAYER];
}

// Turn a `{z}/{x}/{y}` (and optional `{s}` subdomain) template into a
// pigeon-maps provider: (x, y, z, dpr) => url.
function tileProvider(url) {
  return (x, y, z) => {
    const s = 'abc'[(x + y) % 3];
    return url
      .replace('{s}', s)
      .replace('{z}', z)
      .replace('{x}', x)
      .replace('{y}', y);
  };
}

module.exports = {
  DEFAULT_LAYER,
  parseChartLayers,
  chartLayersWithFallback,
  tileProvider,
};
