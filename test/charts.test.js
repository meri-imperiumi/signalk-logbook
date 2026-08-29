const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const charts = require('../src/helpers/charts');

// A SignalK `resources/charts` response is an object keyed by chart identifier.
// Tile charts carry a `tilemapUrl` template; other chart types (WMS, S-57…)
// do not, and can't be rendered as XYZ tile layers. Vector tile charts carry
// the same `tilemapUrl` plus the `chartLayers` source layer ids we generate a
// MapLibre style from.
const sampleResource = {
  osm: {
    identifier: 'osm',
    name: 'OpenStreetMap',
    tilemapUrl: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    type: 'tilelayer',
    minzoom: 0,
    maxzoom: 19,
  },
  noaa: {
    identifier: 'noaa',
    name: 'NOAA ENC',
    tilemapUrl: 'http://localhost:8080/noaa/{z}/{x}/{y}.png',
    type: 'tilelayer',
    minzoom: 4,
    maxzoom: 16,
  },
  wms: {
    identifier: 'wms',
    name: 'Some WMS',
    type: 'WMS',
    chartUrl: 'http://example.com/wms',
  },
  vector: {
    identifier: 'world-display-z0-z11-runtime-z12',
    name: 'Passage vector',
    format: 'pbf',
    type: 'tilelayer',
    minzoom: 0,
    maxzoom: 14,
    chartLayers: ['water', 'landcover', 'transportation', 'seamark'],
    tilemapUrl: '/signalk/v1/api/resources/charts/world-display-z0-z11-runtime-z12/{z}/{x}/{y}',
  },
};

// A parsed vector chart layer, as served for e.g. Open Waters tiles cached by
// signalk-corridor-tile-downloader into an MBTiles file
function sampleVectorLayer() {
  return charts.parseChartLayers({
    passage: {
      identifier: 'passage',
      name: 'Passage',
      format: 'pbf',
      tilemapUrl: '/signalk/v1/api/resources/charts/passage/{z}/{x}/{y}',
      minzoom: 0,
      maxzoom: 14,
      chartLayers: ['water', 'seamark'],
    },
  })[0];
}

test('parseChartLayers returns [] for missing or empty resources', () => {
  assert.deepStrictEqual(charts.parseChartLayers(undefined), []);
  assert.deepStrictEqual(charts.parseChartLayers(null), []);
  assert.deepStrictEqual(charts.parseChartLayers({}), []);
});

test('parseChartLayers keeps only tile charts and maps their fields', () => {
  const layers = charts.parseChartLayers(sampleResource);
  assert.strictEqual(layers.length, 3);
  const osm = layers.find((l) => l.identifier === 'osm');
  assert.deepStrictEqual(osm, {
    identifier: 'osm',
    name: 'OpenStreetMap',
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    minZoom: 0,
    maxZoom: 19,
    format: null,
    sourceLayers: [],
  });
  // The WMS chart has no tilemapUrl and must be dropped
  assert.ok(!layers.some((l) => l.identifier === 'wms'));
});

test('parseChartLayers keeps vector tile charts for the MapLibre renderer', () => {
  const layers = charts.parseChartLayers(sampleResource);
  const vector = layers.find((l) => l.identifier === 'world-display-z0-z11-runtime-z12');
  assert.ok(vector, 'vector chart is kept');
  assert.strictEqual(vector.format, 'pbf');
  assert.ok(charts.isVectorLayer(vector));
  assert.strictEqual(vector.minZoom, 0);
  assert.strictEqual(vector.maxZoom, 14);
  assert.deepStrictEqual(vector.sourceLayers, ['water', 'landcover', 'transportation', 'seamark']);
});

test('isVectorLayer is false for raster layers and the default layer', () => {
  const layers = charts.parseChartLayers(sampleResource);
  assert.ok(!layers.some((l) => charts.isVectorLayer(l) && l.identifier !== 'world-display-z0-z11-runtime-z12'));
  assert.ok(!charts.isVectorLayer(charts.DEFAULT_LAYER));
});

test('parseChartLayers keeps vector formats case-insensitively', () => {
  ['pbf', 'PBF', 'mvt', 'MVT'].forEach((format) => {
    const layers = charts.parseChartLayers({
      vector: {
        identifier: 'v', name: 'V', format, tilemapUrl: 'http://x/{z}/{x}/{y}',
      },
    });
    assert.strictEqual(layers.length, 1, `format ${format} should be kept`);
    assert.strictEqual(layers[0].format, format.toLowerCase());
    assert.ok(charts.isVectorLayer(layers[0]), `format ${format} is a vector layer`);
  });
});

test('parseChartLayers keeps raster charts that declare a format', () => {
  const layers = charts.parseChartLayers({
    png: {
      identifier: 'png', name: 'PNG chart', format: 'png', tilemapUrl: 'http://x/{z}/{x}/{y}',
    },
  });
  assert.strictEqual(layers.length, 1);
  assert.strictEqual(layers[0].identifier, 'png');
  assert.strictEqual(layers[0].format, 'png');
  assert.ok(!charts.isVectorLayer(layers[0]));
});

test('parseChartLayers keeps charts with no format declared', () => {
  const layers = charts.parseChartLayers({
    plain: { identifier: 'plain', name: 'Plain', tilemapUrl: 'http://x/{z}/{x}/{y}' },
  });
  assert.strictEqual(layers.length, 1);
});

test('parseChartLayers drops the corridor downloader cache charts', () => {
  // The downloader's seamap cache and its derived mirrors register names like
  // "Signal K Corridor Cache" / "Signal K Corridor Cache — <source id>"; the
  // logbook renders the mirrored style instead, so hide the raw caches
  const layers = charts.parseChartLayers({
    seamap: {
      identifier: 'passage_cache',
      name: 'Signal K Corridor Cache',
      format: 'png',
      type: 'tilelayer',
      tilemapUrl: '/signalk/v1/api/resources/charts/passage_cache/{z}/{x}/{y}',
      minzoom: 8,
      maxzoom: 14,
    },
    bathy: {
      identifier: 'seascape-vector',
      name: 'Signal K Corridor Cache — seascape-vector',
      format: 'pbf',
      tilemapUrl: '/signalk/v1/api/resources/charts/seascape-vector/{z}/{x}/{y}',
      chartLayers: ['depth'],
    },
    other: {
      identifier: 'other',
      name: 'Some other chart',
      tilemapUrl: 'http://x/{z}/{x}/{y}',
    },
  });
  assert.strictEqual(layers.length, 1);
  assert.strictEqual(layers[0].identifier, 'other');
});

test('chartLayersWithFallback falls back to the default when only corridor caches are configured', () => {
  assert.deepStrictEqual(
    charts.chartLayersWithFallback({
      seamap: {
        identifier: 'passage_cache',
        name: 'Signal K Corridor Cache',
        format: 'png',
        tilemapUrl: '/signalk/v1/api/resources/charts/passage_cache/{z}/{x}/{y}',
      },
    }),
    [charts.DEFAULT_LAYER],
  );
});

test('parseChartLayers sorts layers by name for a stable switcher', () => {
  const names = charts.parseChartLayers(sampleResource).map((l) => l.name);
  assert.deepStrictEqual(names, ['NOAA ENC', 'OpenStreetMap', 'Passage vector']);
});

test('chartLayersWithFallback returns configured layers untouched when present', () => {
  const layers = charts.chartLayersWithFallback(sampleResource);
  assert.deepStrictEqual(layers, charts.parseChartLayers(sampleResource));
});

test('chartLayersWithFallback falls back to a single default layer when empty', () => {
  assert.deepStrictEqual(charts.chartLayersWithFallback({}), [charts.DEFAULT_LAYER]);
  assert.deepStrictEqual(charts.chartLayersWithFallback(undefined), [charts.DEFAULT_LAYER]);
});

test('chartAssetsFromManifest: only a manifest with an absolute style URL counts', () => {
  const style = 'http://host:3000/plugins/signalk-corridor-tile-downloader/assets/style.json';
  assert.deepStrictEqual(
    charts.chartAssetsFromManifest({ style, fonts: ['Noto Sans Regular'] }),
    { style },
  );
  // No style (older downloader / mirror incomplete) → composed-style fallback
  assert.strictEqual(charts.chartAssetsFromManifest({ fonts: [] }), null);
  assert.strictEqual(
    charts.chartAssetsFromManifest({ style: '/plugins/relative/style.json' }),
    null,
  );
  assert.strictEqual(charts.chartAssetsFromManifest(null), null);
  assert.strictEqual(charts.chartAssetsFromManifest(undefined), null);
  assert.strictEqual(charts.chartAssetsFromManifest('junk'), null);
});

test('chartLayersWithFallback mounts the mirrored style over vector charts', () => {
  const manifest = {
    style: 'http://host:3000/plugins/signalk-corridor-tile-downloader/assets/style.json',
  };
  const layers = charts.chartLayersWithFallback(sampleResource, manifest);
  // Mirror first (default selection), raster charts kept, composed
  // vector charts replaced — the mirror renders the same tiles with
  // full symbology
  assert.strictEqual(layers.length, 3);
  assert.strictEqual(layers[0].identifier, '__chart_mirror__');
  assert.strictEqual(layers[0].name, 'Open Waters chart');
  assert.strictEqual(layers[0].format, 'pbf');
  assert.strictEqual(
    layers[0].styleUrl,
    'http://host:3000/plugins/signalk-corridor-tile-downloader/assets/style.json',
  );
  assert.ok(charts.isVectorLayer(layers[0]), 'mirror renders with MapLibre');
  assert.ok(layers.some((l) => l.identifier === 'osm'), 'raster chart kept');
  assert.ok(layers.some((l) => l.identifier === 'noaa'), 'raster chart kept');
  assert.ok(
    !layers.some((l) => l.identifier === 'world-display-z0-z11-runtime-z12'),
    'composed vector chart replaced by the mirror',
  );
});

test('chartLayersWithFallback mounts the mirror also with no configured charts', () => {
  const manifest = { style: 'http://host:3000/plugins/style.json' };
  // The downloader serves its mirrored style independently of
  // resources/charts, so no OSM fallback is wanted either
  const layers = charts.chartLayersWithFallback({}, manifest);
  assert.strictEqual(layers.length, 1);
  assert.strictEqual(layers[0].identifier, '__chart_mirror__');
  assert.ok(!layers.some((l) => l.identifier === 'osm'), 'no OSM fallback when mirrored');
});

test('chartLayersWithFallback ignores manifests without a usable style', () => {
  assert.deepStrictEqual(
    charts.chartLayersWithFallback(sampleResource, { fonts: [] }),
    charts.parseChartLayers(sampleResource),
  );
  assert.deepStrictEqual(
    charts.chartLayersWithFallback(sampleResource, null),
    charts.parseChartLayers(sampleResource),
  );
});

test('rasterStyle builds a MapLibre raster style from a chart layer', () => {
  const style = charts.rasterStyle(charts.DEFAULT_LAYER);
  assert.strictEqual(style.version, 8);
  assert.strictEqual(style.sources.chart.type, 'raster');
  assert.deepStrictEqual(style.sources.chart.tiles, [
    'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  ]);
  // 256 is the standard XYZ tile size Signal K chart providers serve
  assert.strictEqual(style.sources.chart.tileSize, 256);
  assert.strictEqual(style.sources.chart.minzoom, 0);
  assert.strictEqual(style.sources.chart.maxzoom, 19);
  assert.deepStrictEqual(style.layers.map((l) => l.id), ['chart-background', 'chart-raster']);
  assert.strictEqual(style.layers[1].source, 'chart');
  assert.strictEqual(style.layers[1].type, 'raster');
});

test('rasterStyle expands {s} subdomains into per-host tile URLs', () => {
  const layer = charts.parseChartLayers({
    s: {
      identifier: 's', name: 'Subdomains', tilemapUrl: 'https://{s}.example.com/{z}/{x}/{y}.png',
    },
  })[0];
  // MapLibre has no {s} token of its own, so every subdomain becomes one
  // tile URL it can spread requests across
  assert.deepStrictEqual(charts.rasterStyle(layer).sources.chart.tiles, [
    'https://a.example.com/{z}/{x}/{y}.png',
    'https://b.example.com/{z}/{x}/{y}.png',
    'https://c.example.com/{z}/{x}/{y}.png',
  ]);
});

test('rasterStyle resolves relative tile URLs against the page location', () => {
  global.window = { location: { href: 'http://localhost:3000/logbook/' } };
  try {
    const layer = charts.parseChartLayers({
      noaa: {
        identifier: 'noaa',
        name: 'NOAA',
        tilemapUrl: '/signalk/v1/api/resources/charts/noaa/{z}/{x}/{y}.png',
      },
    })[0];
    assert.deepStrictEqual(charts.rasterStyle(layer).sources.chart.tiles, [
      'http://localhost:3000/signalk/v1/api/resources/charts/noaa/{z}/{x}/{y}.png',
    ]);
  } finally {
    delete global.window;
  }
});

test('mapStyle mounts a mirrored style wholesale, else matches the chart format', () => {
  assert.strictEqual(
    charts.mapStyle({ styleUrl: 'http://host/style.json' }),
    'http://host/style.json',
  );
  assert.deepStrictEqual(
    charts.mapStyle(sampleVectorLayer()),
    charts.vectorStyle(sampleVectorLayer()),
  );
  assert.deepStrictEqual(
    charts.mapStyle(charts.DEFAULT_LAYER),
    charts.rasterStyle(charts.DEFAULT_LAYER),
  );
});

test('vectorStyle builds a MapLibre vector style from a chart layer', () => {
  const style = charts.vectorStyle(sampleVectorLayer());
  assert.strictEqual(style.version, 8);
  assert.strictEqual(style.sources.chart.type, 'vector');
  assert.deepStrictEqual(style.sources.chart.tiles, [
    '/signalk/v1/api/resources/charts/passage/{z}/{x}/{y}',
  ]);
  assert.strictEqual(style.sources.chart.minzoom, 0);
  assert.strictEqual(style.sources.chart.maxzoom, 14);
  assert.strictEqual(style.layers[0].type, 'background');
});

test('vectorStyle generates fill, line and circle layers per source layer', () => {
  const style = charts.vectorStyle(sampleVectorLayer());
  const ids = style.layers.map((l) => l.id);
  ['chart-water', 'chart-seamark'].forEach((sourceLayer) => {
    ['fill', 'line', 'circle'].forEach((type) => {
      assert.ok(ids.includes(`${sourceLayer}-${type}`), `${sourceLayer}-${type} exists`);
    });
  });
  const waterFill = style.layers.find((l) => l.id === 'chart-water-fill');
  assert.strictEqual(waterFill.source, 'chart');
  assert.strictEqual(waterFill['source-layer'], 'water');
  // Fills paint before lines, lines before circles
  const lastOf = (type) => Math.max(...style.layers.map((l, i) => (l.type === type ? i : -1)));
  const firstOf = (type) => style.layers.findIndex((l) => l.type === type);
  assert.ok(lastOf('fill') < firstOf('line'));
  assert.ok(lastOf('line') < firstOf('circle'));
});

test('vectorStyle colors layers from the name-based palette', () => {
  const style = charts.vectorStyle(sampleVectorLayer());
  assert.strictEqual(
    style.layers.find((l) => l.id === 'chart-water-fill').paint['fill-color'],
    '#a0c6dc',
  );
  assert.strictEqual(
    style.layers.find((l) => l.id === 'chart-seamark-line').paint['line-color'],
    '#a44a3f',
  );
  assert.strictEqual(
    style.layers.find((l) => l.id === 'chart-seamark-circle').paint['circle-color'],
    '#d9534f',
  );
  // Unknown source layer names get the neutral defaults
  const landcover = charts.vectorStyle(charts.parseChartLayers({
    v: {
      identifier: 'v',
      name: 'V',
      format: 'pbf',
      tilemapUrl: 'http://x/{z}/{x}/{y}',
      chartLayers: ['zzz'],
    },
  })[0]);
  assert.strictEqual(
    landcover.layers.find((l) => l.id === 'chart-zzz-fill').paint['fill-color'],
    '#dcd7c7',
  );
});

test('vectorStyle dedupes style layer ids after sanitizing names', () => {
  const layer = charts.parseChartLayers({
    v: {
      identifier: 'v',
      name: 'V',
      format: 'pbf',
      tilemapUrl: 'http://x/{z}/{x}/{y}',
      chartLayers: ['weird layer!', 'weird_layer_'],
    },
  })[0];
  const style = charts.vectorStyle(layer);
  const ids = style.layers.map((l) => l.id);
  assert.strictEqual(new Set(ids).size, ids.length);
});

test('vectorStyle renders only a background when no source layers are known', () => {
  const layer = charts.parseChartLayers({
    v: {
      identifier: 'v',
      name: 'V',
      format: 'pbf',
      tilemapUrl: 'http://x/{z}/{x}/{y}',
    },
  })[0];
  const style = charts.vectorStyle(layer);
  assert.strictEqual(style.layers.length, 1);
  assert.strictEqual(style.layers[0].type, 'background');
});

test('vectorStyle resolves relative tile URLs against the page location', () => {
  global.window = { location: { href: 'http://localhost:3000/logbook/' } };
  try {
    const style = charts.vectorStyle(sampleVectorLayer());
    assert.strictEqual(
      style.sources.chart.tiles[0],
      'http://localhost:3000/signalk/v1/api/resources/charts/passage/{z}/{x}/{y}',
    );
  } finally {
    delete global.window;
  }
});

test('mirror wiring: Map fetches the manifest, ChartMap mounts the style', () => {
  const map = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'Map.jsx'), 'utf8');
  assert.match(map, /CHART_MIRROR_MANIFEST_URL/);
  assert.match(map, /chartLayersWithFallback\(resource, manifest\)/);
  // Everything renders through MapLibre now; pigeon-maps is gone
  assert.doesNotMatch(map, /pigeon-maps/);
  assert.match(map, /ChartMap/);
  const chartMap = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'ChartMap.jsx'), 'utf8');
  // A mirrored style URL wins over the generated styles, which are picked
  // by format
  assert.match(chartMap, /mapStyle\(props\.layer\)/);
});

test('map wiring: the map starts zoomed to fit the track', () => {
  const chartMap = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'ChartMap.jsx'), 'utf8');
  // Constructor bounds instead of MapLibre's [0,0] world view, a re-fit
  // once loaded, and a re-fit when the point set updates (history fetch)
  assert.match(chartMap, /fitBoundsOptions: FIT_OPTIONS/);
  assert.match(chartMap, /map\.fitBounds\(loadedBounds, FIT_OPTIONS\)/);
  assert.match(chartMap, /}, \[props\.points\]\)/);
});

test('map wiring: no tiles render until the chart list resolves', () => {
  const map = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'Map.jsx'), 'utf8');
  // Fetching the chart resources (and the corridor manifest) can take a
  // while; the layers state starts as null and a loading placeholder
  // renders in its place, so no network-based OpenStreetMap tiles load first
  assert.match(map, /useState\(null\)/);
  assert.match(map, /Loading charts/);
});
