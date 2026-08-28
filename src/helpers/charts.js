// Tile-layer helpers for the log Map. SignalK exposes configured charts at
// `resources/charts`; we turn the tile charts into layers the map can render,
// showing whatever the user has set up (offline MBTiles, ENCs, a
// referer-tolerant proxy…) instead of hardcoding OSM's public tiles, which now
// 403 for referer-less self-hosted setups (issue #76).
//
// Raster charts render through pigeon-maps providers (`tileProvider`). Vector
// tile charts (`format: "pbf"`/`"mvt"`, e.g. Open Waters tiles cached by
// signalk-corridor-tile-downloader) cannot be drawn as raster tiles (issue
// #100), so they carry their source layers through to `vectorStyle()`, which
// generates a MapLibre GL style for the WebGL renderer in VectorMap.

// Backward-compatible default when no tile charts are configured.
const DEFAULT_LAYER = {
  identifier: 'osm',
  name: 'OpenStreetMap',
  url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  minZoom: 0,
  maxZoom: 19,
};

const VECTOR_FORMATS = ['pbf', 'mvt'];

function isVectorFormat(format) {
  return Boolean(format) && VECTOR_FORMATS.includes(String(format).toLowerCase());
}

// Is a parsed layer a vector tile chart? Vector layers render with MapLibre
// (components/VectorMap), raster ones with pigeon-maps.
function isVectorLayer(layer) {
  return isVectorFormat(layer.format);
}

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
        format: chart.format ? String(chart.format).toLowerCase() : null,
        // Vector source layer ids, used to generate a MapLibre style
        sourceLayers: Array.isArray(chart.chartLayers)
          ? chart.chartLayers.filter((id) => typeof id === 'string')
          : [],
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

// MapLibre tile URLs must be absolute; server-provided tilemapUrls may be
// relative to the Signal K host the webapp is served from. Built manually
// instead of via `new URL()`, which percent-encodes the `{z}/{x}/{y}` template
// tokens MapLibre substitutes.
function absoluteUrl(url) {
  if (typeof window === 'undefined' || !window.location) {
    return url;
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith('//')) {
    return url;
  }
  const base = new URL(window.location.href).origin;
  return url.startsWith('/') ? base + url : `${base}/${url}`;
}

// Palette and name heuristics for the generated vector style. Without a
// locally hosted style.json (sprites and glyphs) we can only draw geometry,
// so colors are guessed from source layer names: good enough to read
// coastlines, water areas, depth contours and seamarks on Open Waters tiles.
const VECTOR_COLORS = {
  background: '#a9cbd9',
  waterFill: '#a0c6dc',
  landFill: '#e2decd',
  sandFill: '#eadfc4',
  buildingFill: '#d8d0c2',
  defaultFill: '#dcd7c7',
  depthLine: '#6f93b8',
  boundaryLine: '#a08a70',
  routeLine: '#a44a3f',
  roadLine: '#a39c92',
  defaultLine: '#8d8679',
  seamarkPoint: '#d9534f',
  defaultPoint: '#5b6770',
};

const FILL_MATCHERS = [
  [/water|sea|ocean|lake|river|stream|canal|bay|harbo|dock|anchorage|fairway/i, VECTOR_COLORS.waterFill],
  [/sand|beach|shore/i, VECTOR_COLORS.sandFill],
  [/building|structure|pier|quay|wharf/i, VECTOR_COLORS.buildingFill],
  [/land|ground|surface|cover|use|wood|forest|grass|park|wetland|marsh|island|reef|rock|terrain|elevation/i, VECTOR_COLORS.landFill],
];

const LINE_MATCHERS = [
  [/contour|depth|sounding|bathy/i, VECTOR_COLORS.depthLine],
  [/boundary|border|admin|limit/i, VECTOR_COLORS.boundaryLine],
  [/seamark|mark|buoy|beacon|light|cable|pipeline|traffic|route|channel|fairway|lane|track|warn|restrict|caution/i, VECTOR_COLORS.routeLine],
  [/road|street|highway|rail|path|bridge|transport|aeroway|runway|taxi/i, VECTOR_COLORS.roadLine],
];

const POINT_MATCHERS = [
  [/seamark|mark|buoy|beacon|light|mooring|anchor|signal|notice/i, VECTOR_COLORS.seamarkPoint],
];

function paintColor(matchers, sourceLayer, fallback) {
  const match = matchers.find(([test]) => test.test(sourceLayer));
  return match ? match[1] : fallback;
}

// Style layer ids must be unique alphanumeric (plus `_-.`) strings
function styleLayerId(sourceLayer, suffix) {
  return `chart-${String(sourceLayer).replace(/[^a-zA-Z0-9_.-]/g, '_')}-${suffix}`;
}

// Build a MapLibre GL style for a vector chart layer: a background, then a
// fill, line and circle layer per vector source layer. MapLibre skips
// features whose geometry doesn't match the layer type, so every source layer
// can safely get all three without knowing the schema's geometry types.
// Fills are emitted before lines, lines before circles, so strokes and points
// are never painted over by later area fills.
function vectorStyle(layer) {
  const layers = [
    {
      id: 'chart-background',
      type: 'background',
      paint: { 'background-color': VECTOR_COLORS.background },
    },
  ];
  const seen = new Set(layers.map((styleLayer) => styleLayer.id));
  const addLayer = (candidate) => {
    if (seen.has(candidate.id)) {
      return;
    }
    seen.add(candidate.id);
    layers.push(candidate);
  };

  const byType = (type, matchers, fallback, paint) => (
    layer.sourceLayers.map((sourceLayer) => ({
      id: styleLayerId(sourceLayer, type),
      type,
      source: 'chart',
      'source-layer': sourceLayer,
      paint: paint(paintColor(matchers, sourceLayer, fallback)),
    }))
  );

  byType('fill', FILL_MATCHERS, VECTOR_COLORS.defaultFill, (color) => ({
    'fill-color': color,
    'fill-opacity': 0.9,
  })).forEach(addLayer);
  byType('line', LINE_MATCHERS, VECTOR_COLORS.defaultLine, (color) => ({
    'line-color': color,
    'line-width': 1,
  })).forEach(addLayer);
  byType('circle', POINT_MATCHERS, VECTOR_COLORS.defaultPoint, (color) => ({
    'circle-color': color,
    'circle-radius': 3,
  })).forEach(addLayer);

  return {
    version: 8,
    sources: {
      chart: {
        type: 'vector',
        tiles: [absoluteUrl(layer.url)],
        minzoom: layer.minZoom,
        maxzoom: layer.maxZoom,
      },
    },
    layers,
  };
}

module.exports = {
  DEFAULT_LAYER,
  parseChartLayers,
  chartLayersWithFallback,
  tileProvider,
  isVectorLayer,
  vectorStyle,
};
