const test = require('node:test');
const assert = require('node:assert');
const charts = require('../src/helpers/charts');

// A SignalK `resources/charts` response is an object keyed by chart identifier.
// Tile charts carry a `tilemapUrl` template; other chart types (WMS, S-57…)
// do not and can't be shown as Leaflet/pigeon tiles.
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
  // Vector tile charts do have a tilemapUrl, but serve protobuf rather than
  // images, so they can't be drawn as a raster tile layer (issue #100).
  vector: {
    identifier: 'world-display-z0-z11-runtime-z12',
    name: 'World vector',
    format: 'pbf',
    type: 'tilelayer',
    tilemapUrl: '/signalk/v1/api/resources/charts/world-display-z0-z11-runtime-z12/{z}/{x}/{y}',
  },
};

test('parseChartLayers returns [] for missing or empty resources', () => {
  assert.deepStrictEqual(charts.parseChartLayers(undefined), []);
  assert.deepStrictEqual(charts.parseChartLayers(null), []);
  assert.deepStrictEqual(charts.parseChartLayers({}), []);
});

test('parseChartLayers keeps only tile charts and maps their fields', () => {
  const layers = charts.parseChartLayers(sampleResource);
  assert.strictEqual(layers.length, 2);
  const osm = layers.find((l) => l.identifier === 'osm');
  assert.deepStrictEqual(osm, {
    identifier: 'osm',
    name: 'OpenStreetMap',
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    minZoom: 0,
    maxZoom: 19,
  });
  // The WMS chart has no tilemapUrl and must be dropped
  assert.ok(!layers.some((l) => l.identifier === 'wms'));
});

test('parseChartLayers drops vector tile charts', () => {
  const layers = charts.parseChartLayers(sampleResource);
  assert.ok(!layers.some((l) => l.identifier === 'world-display-z0-z11-runtime-z12'));
});

test('parseChartLayers drops vector formats case-insensitively', () => {
  ['pbf', 'PBF', 'mvt', 'MVT'].forEach((format) => {
    const layers = charts.parseChartLayers({
      vector: {
        identifier: 'v', name: 'V', format, tilemapUrl: 'http://x/{z}/{x}/{y}',
      },
    });
    assert.deepStrictEqual(layers, [], `format ${format} should be dropped`);
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
});

test('parseChartLayers keeps charts with no format declared', () => {
  const layers = charts.parseChartLayers({
    plain: { identifier: 'plain', name: 'Plain', tilemapUrl: 'http://x/{z}/{x}/{y}' },
  });
  assert.strictEqual(layers.length, 1);
});

test('parseChartLayers sorts layers by name for a stable switcher', () => {
  const names = charts.parseChartLayers(sampleResource).map((l) => l.name);
  assert.deepStrictEqual(names, ['NOAA ENC', 'OpenStreetMap']);
});

test('chartLayersWithFallback returns configured layers untouched when present', () => {
  const layers = charts.chartLayersWithFallback(sampleResource);
  assert.strictEqual(layers.length, 2);
  assert.ok(!layers.some((l) => l.identifier === charts.DEFAULT_LAYER.identifier
    && l.url === charts.DEFAULT_LAYER.url && layers.length > 2));
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
