import React, { useEffect, useRef } from 'react';
// Import MapLibre's unminified build: the default ESM entry ships
// pre-minified, and re-minifying it with terser mangles sibling-scope names
// into collisions (Transform.clone() ended up calling `new Float64Array(4)
//   .apply(...)`), crashing the map with "e.apply is not a function"
import { Map as MapLibreMap, Marker, setWorkerUrl } from 'maplibre-gl/dist/maplibre-gl-dev.mjs';
import 'maplibre-gl/dist/maplibre-gl.css';
import { vectorStyle, assetUrl } from '../helpers/charts';
import { entryMarkerColor } from '../helpers/markers';

// MapLibre GL container for vector tile charts (`format: pbf`/`mvt`), which
// pigeon-maps cannot draw. The chart style is generated from the chart's
// source layers (helpers/charts `vectorStyle`). Track and entry markers are
// drawn to match the raster Map component.
//
// The component is keyed by chart identifier in Map, so a new chart creates a
// fresh instance instead of migrating styles mid-flight.

// MapLibre spawns tile-parsing workers from `WORKER_URL`. Its bundled
// default derives a worker URL from `import.meta.url`, which webpack compiles
// to a build-time `file://` path that browsers cannot load — vector tiles then
// never parse and the map stays blank. Point it at the worker files copied
// into `public/vendor/` by webpack (see webpack.config.js), resolved against
// this webapp's runtime public path so it works both standalone and embedded.
setWorkerUrl(assetUrl('vendor/maplibre-gl-worker-dev.mjs'));

// [[west, south], [ east, north]] from the given points, or null
function boundsOf(points) {
  const valid = points.filter((p) => Number.isFinite(Number(p.lat))
    && Number.isFinite(Number(p.lon)));
  if (!valid.length) {
    return null;
  }
  const lons = valid.map((p) => Number(p.lon));
  const lats = valid.map((p) => Number(p.lat));
  return [
    [Math.min(...lons), Math.min(...lats)],
    [Math.max(...lons), Math.max(...lats)],
  ];
}

function drawMarkers(map, markersRef, entries, viewEntry) {
  markersRef.current = entries.map((entry) => {
    const marker = new Marker({
      color: entryMarkerColor(entry.category),
      scale: 0.7,
    })
      .setLngLat([entry.position.longitude, entry.position.latitude])
      .addTo(map);
    marker.getElement().addEventListener('click', (event) => {
      event.stopPropagation();
      viewEntry(entry);
    });
    return marker;
  });
}

function VectorMap(props) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef([]);
  // Latest props for callbacks that outlive a render (map load)
  const latestRef = useRef(props);
  latestRef.current = props;

  useEffect(() => {
    if (!containerRef.current) {
      return undefined;
    }
    const map = new MapLibreMap({
      container: containerRef.current,
      // A mirrored upstream style (corridor downloader manifest, see
      // helpers/charts) carries the full symbology; the generated
      // geometry-only style is the fallback
      style: props.layer.styleUrl || vectorStyle(props.layer),
      attributionControl: false,
    });
    mapRef.current = map;

    map.on('load', () => {
      map.addSource('track', {
        type: 'geojson',
        data: latestRef.current.geoJson,
      });
      map.addLayer({
        id: 'track-line',
        type: 'line',
        source: 'track',
        layout: {
          'line-cap': 'round',
          'line-join': 'round',
        },
        paint: {
          'line-color': '#ff0000',
          'line-width': 1.5,
        },
      });
      drawMarkers(map, markersRef, latestRef.current.entries, latestRef.current.viewEntry);
      const bounds = boundsOf(latestRef.current.points);
      if (bounds) {
        // maxZoom keeps a single point (degenerate bounds) sensible
        map.fitBounds(bounds, { padding: 40, maxZoom: 11, animate: false });
      }
    });

    return () => {
      markersRef.current = [];
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Track updates, e.g. when the position history fetch resolves
  useEffect(() => {
    const map = mapRef.current;
    const source = map && map.getSource('track');
    if (source) {
      source.setData(props.geoJson);
    }
  }, [props.geoJson]);

  // Markers follow the selected entries
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.getSource('track')) {
      return;
    }
    markersRef.current.forEach((marker) => marker.remove());
    drawMarkers(map, markersRef, props.entries, props.viewEntry);
  }, [props.entries]);

  return (
    <div
      ref={containerRef}
      style={{ width: '100%', height: '100%' }}
    />
  );
}

export default VectorMap;
