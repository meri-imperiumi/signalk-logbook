const test = require('node:test');
const assert = require('node:assert');
const charts = require('../src/helpers/charts');

// A SignalK `resources/charts` response is an object keyed by chart identifier.
// Tile charts carry a `tilemapUrl` template; other chart types (WMS, S-57…)
// do not and can't be shown as pigeon tiles. Vector tile charts carry the
// same `tilemapUrl` plus the `chartLayers` source layer ids we generate a
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

test('tileProvider substitutes {z}/{x}/{y} into the template', () => {
  const provider = charts.tileProvider('https://tile.openstreetmap.org/{z}/{x}/{y}.png');
  assert.strictEqual(provider(5, 3, 7), 'https://tile.openstreetmap.org/7/5/3.png');
});

test('tileProvider rotates {s} subdomains deterministically', () => {
  const provider = charts.tileProvider('https://{s}.example.com/{z}/{x}/{y}.png');
  // subdomain chosen from x+y so the same tile always hits the same host
  assert.strictEqual(provider(0, 0, 1), 'https://a.example.com/1/0/0.png');
  assert.strictEqual(provider(1, 0, 1), 'https://b.example.com/1/1/0.png');
  assert.strictEqual(provider(1, 1, 1), 'https://c.example.com/1/1/1.png');
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
