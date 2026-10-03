// Tile-layer helpers for the log Map. SignalK exposes configured charts at
// `resources/charts`; we turn the tile charts into layers the map can render,
// showing whatever the user has set up (offline MBTiles, ENCs, a
// referer-tolerant proxy…) instead of hardcoding OSM's public tiles, which now
// 403 for referer-less self-hosted setups (issue #76). The OSM default stays
// selectable alongside whatever is configured, so there is always a basemap
// to switch to even when the only chart around is a data layer.
//
// Every chart renders through MapLibre GL (components/ChartMap). Raster
// tile charts get a generated raster style; vector tile charts (`format:
// "pbf"`/`"mvt"`, e.g. Open Waters tiles cached by
// signalk-corridor-tile-downloader, issue #100) get `vectorStyle()`, which
// composes geometry-only layers from the chart's source layers.
//
// When the corridor downloader has mirrored the upstream chart style, its
// asset manifest carries the style URL and the map mounts that wholesale
// (full symbology: base map, bathymetry, labels) instead — the composed
// geometry-only style stays as the fallback for chart sources without a
// mirror. Same approach as signalk-dead-reckoning (work doc #20). Its raw
// MBTiles caches ("Signal K Corridor Cache…") are dropped from the layer
// list entirely: offline caches for other chart consumers, rendered here
// properly by the mirror (or the composed fallback) instead.

// Backward-compatible default when no tile charts are configured.
const DEFAULT_LAYER = {
  identifier: 'osm',
  name: 'OpenStreetMap',
  url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  minZoom: 0,
  maxZoom: 19,
};

const VECTOR_FORMATS = ['pbf', 'mvt'];

// Name prefix the corridor tile downloader stamps on its MBTiles caches (the
// seamap file and derived mirrors). Those are offline caches surfaced through
// `resources/charts`; in the logbook map the mirrored style (or the composed
// vector fallback) renders the same tiles properly, so the raw caches would
// only add duplicate, geometry-only entries to the layer switcher.
const CORRIDOR_CACHE_NAME = 'Signal K Corridor Cache';

function isCorridorCache(chart) {
  return typeof chart.name === 'string'
    && chart.name.includes(CORRIDOR_CACHE_NAME);
}

// Live, periodically refreshed charts (weather radar, storm cells) declare a
// `refreshInterval`. They are overlays for a plotter, not basemaps for the
// log map, and a radar network can add a dozen of them to the switcher.
function isLiveOverlay(chart) {
  return typeof chart.refreshInterval === 'number' && chart.refreshInterval > 0;
}

function isVectorFormat(format) {
  return Boolean(format) && VECTOR_FORMATS.includes(String(format).toLowerCase());
}

// Is a parsed layer a vector tile chart? Decides which generated style
// `mapStyle` composes for ChartMap.
function isVectorLayer(layer) {
  return isVectorFormat(layer.format);
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

// A style served by the Signal K server (a mapstyleJSON chart) may reference
// its sprite, glyphs and sources with host-relative URLs. MapLibre refuses a
// relative sprite URL outright and can't resolve relative ones from its
// workers, so ChartMap passes such a style through this before committing
// it. Absolute URLs are left alone.
function absoluteStyle(style) {
  if (!style || typeof style !== 'object') {
    return style;
  }
  const out = { ...style };
  if (typeof out.sprite === 'string') {
    out.sprite = absoluteUrl(out.sprite);
  } else if (Array.isArray(out.sprite)) {
    out.sprite = out.sprite.map((sprite) => ({ ...sprite, url: absoluteUrl(sprite.url) }));
  }
  if (typeof out.glyphs === 'string') {
    out.glyphs = absoluteUrl(out.glyphs);
  }
  if (out.sources && typeof out.sources === 'object') {
    out.sources = Object.fromEntries(Object.entries(out.sources).map(([id, source]) => {
      const next = { ...source };
      if (typeof next.url === 'string') {
        next.url = absoluteUrl(next.url);
      }
      if (Array.isArray(next.tiles)) {
        next.tiles = next.tiles.map(absoluteUrl);
      }
      return [id, next];
    }));
  }
  return out;
}

// Normalize a SignalK `resources/charts` object into the layers we can
// render. The v2 Resources API gives a chart's tile template (or, for a
// `mapstyleJSON` chart, its style) as `url`; v1 gives the tile template as
// `tilemapUrl`. Tile charts become raster or vector layers; `mapstyleJSON`
// charts (e.g. Open Waters online) are mounted as a whole style, like the
// corridor mirror. Other chart types (WMS, S-57, plain PDFs…), live overlays
// and the corridor downloader's raw cache charts are dropped.
function parseChartLayers(resource) {
  if (!resource || typeof resource !== 'object') {
    return [];
  }
  return Object.keys(resource)
    .map((key) => {
      const chart = resource[key];
      const url = chart && (chart.tilemapUrl || chart.url);
      if (!url || isCorridorCache(chart) || isLiveOverlay(chart)) {
        return null;
      }
      if (chart.type === 'mapstyleJSON') {
        return {
          identifier: chart.identifier || key,
          name: chart.name || chart.identifier || key,
          url,
          styleUrl: absoluteUrl(url),
          minZoom: typeof chart.minzoom === 'number' ? chart.minzoom : 0,
          maxZoom: typeof chart.maxzoom === 'number' ? chart.maxzoom : 19,
          format: null,
          sourceLayers: [],
        };
      }
      if (chart.type && chart.type !== 'tilelayer') {
        return null;
      }
      return {
        identifier: chart.identifier || key,
        name: chart.name || chart.identifier || key,
        url,
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

// The corridor tile downloader's asset manifest, mirroring the upstream
// chart style (full symbology: base map, bathymetry, labels) for offline
// use. When it carries a style, the map mounts it wholesale instead of
// composing geometry-only styles per chart.
const CHART_MIRROR_MANIFEST_URL = '/plugins/signalk-corridor-tile-downloader/assets/manifest.json';

// Identifier of the synthetic layer mounted for a mirrored chart style.
const CHART_MIRROR_IDENTIFIER = '__chart_mirror__';

// Validate the corridor downloader's asset manifest: only a manifest with
// an absolute style URL counts, since MapLibre fetches the style over HTTP
// and a relative URL would resolve against the webapp instead of the Signal
// K server. Anything else (older downloader, incomplete mirror, junk)
// yields null so callers keep the composed-style fallback.
function chartAssetsFromManifest(value) {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const { style } = value;
  if (typeof style !== 'string' || !/^https?:\/\//i.test(style)) {
    return null;
  }
  return { style };
}

// The synthetic vector layer for a mirrored chart style, or null. The style
// URL carries tiles, zooms and symbology, so ChartMap hands it to MapLibre
// directly instead of generating a style.
function mirroredChartLayer(manifest) {
  const assets = chartAssetsFromManifest(manifest);
  if (!assets) {
    return null;
  }
  return {
    identifier: CHART_MIRROR_IDENTIFIER,
    name: 'Open Waters chart',
    format: 'pbf',
    styleUrl: assets.style,
    minZoom: 0,
    maxZoom: 19,
    sourceLayers: [],
  };
}

// Configured tile layers, with the OpenStreetMap default always kept
// selectable. A mirrored upstream style is mounted first and replaces the
// configured vector charts — it renders the same tiles with full symbology,
// the composed styles are only the fallback. Raster charts are always kept.
// OSM is appended as the last switcher entry even when charts are configured:
// a setup whose only chart is a data layer (e.g. the distance-to-shore
// plugin's world coastline tiles) would otherwise be stuck on an unusable
// base. Skipped when a configured chart already is that default — matching on
// identifier or tile URL, either way it would only duplicate the switcher
// (and collide in React's keys).
function chartLayersWithFallback(resource, manifest) {
  const mirror = mirroredChartLayer(manifest);
  const layers = parseChartLayers(resource);
  const base = mirror
    ? [mirror].concat(layers.filter((layer) => !isVectorLayer(layer)))
    : layers;
  if (!base.some((layer) => layer.identifier === DEFAULT_LAYER.identifier
    || layer.url === DEFAULT_LAYER.url)) {
    base.push(DEFAULT_LAYER);
  }
  return base;
}

// URL for a file shipped next to the built webapp (e.g. MapLibre's worker
// scripts under `vendor/`). Resolved against webpack's runtime public path —
// `__webpack_public_path__`, which webpack auto-detects from the script tag —
// so it is correct both standalone (`/@scope/name/`) and embedded in the
// Signal K dashboard.
function assetUrl(path) {
  /* eslint-disable no-undef, camelcase */
  const publicPath = typeof __webpack_public_path__ !== 'undefined'
    ? __webpack_public_path__
    : '';
  /* eslint-enable no-undef, camelcase */
  const base = publicPath
    || (typeof window !== 'undefined' ? window.location.href : undefined);
  if (!base) {
    return path;
  }
  try {
    return new URL(path, base).href;
  } catch (err) {
    return path;
  }
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

// MapLibre substitutes `{z}/{x}/{y}` itself but has no `{s}` subdomain
// token; expand a subdomain template into one tile URL per host so requests
// can still spread across them.
function rasterTileUrls(url) {
  if (!url.includes('{s}')) {
    return [url];
  }
  return ['a', 'b', 'c'].map((s) => url.split('{s}').join(s));
}

// Build a MapLibre GL style for a raster chart layer: the tile pyramid is
// the only painted layer, over a plain background. `tileSize` 256 is the
// standard XYZ size Signal K chart providers serve.
function rasterStyle(layer) {
  return {
    version: 8,
    sources: {
      chart: {
        type: 'raster',
        tiles: rasterTileUrls(absoluteUrl(layer.url)),
        tileSize: 256,
        minzoom: layer.minZoom,
        maxzoom: layer.maxZoom,
      },
    },
    layers: [
      {
        id: 'chart-background',
        type: 'background',
        paint: { 'background-color': VECTOR_COLORS.background },
      },
      {
        id: 'chart-raster',
        type: 'raster',
        source: 'chart',
      },
    ],
  };
}

// The MapLibre style for any chart layer: a mirrored upstream style mounted
// wholesale (full symbology), else a generated style matching the chart's
// format. ChartMap hands this to MapLibre directly.
function mapStyle(layer) {
  if (layer.styleUrl) {
    return layer.styleUrl;
  }
  return isVectorLayer(layer) ? vectorStyle(layer) : rasterStyle(layer);
}

module.exports = {
  DEFAULT_LAYER,
  CHART_MIRROR_MANIFEST_URL,
  parseChartLayers,
  chartAssetsFromManifest,
  chartLayersWithFallback,
  isVectorLayer,
  mapStyle,
  rasterStyle,
  vectorStyle,
  assetUrl,
  absoluteUrl,
  absoluteStyle,
};
