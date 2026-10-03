import React, { useEffect, useRef } from 'react';
// Import MapLibre's unminified build: the default ESM entry ships
// pre-minified, and re-minifying it with terser mangles sibling-scope names
// into collisions (Transform.clone() ended up calling `new Float64Array(4)
//   .apply(...)`), crashing the map with "e.apply is not a function"
import { Map as MapLibreMap, Marker, setWorkerUrl } from 'maplibre-gl/dist/maplibre-gl-dev.mjs';
import 'maplibre-gl/dist/maplibre-gl.css';
import {
  mapStyle, assetUrl, absoluteUrl, absoluteStyle,
} from '../helpers/charts';
import { entryMarkerColor } from '../helpers/markers';

// MapLibre GL container for the log map, rendering every chart layer: raster
// and vector tile charts through styles generated from the chart
// (helpers/charts `mapStyle`), a mirrored upstream style wholesale. Track and
// entry markers are drawn on top, zoomed to fit the track like the old
// pigeon-maps renderer did from its center/zoom props.
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

// Camera options for fitting the track into the viewport: some padding
// around the bounds, and a maxZoom so a single point (degenerate bounds)
// doesn't zoom into the tile floor.
const FIT_OPTIONS = { padding: 40, maxZoom: 11, animate: false };

// [[west, south], [ east, north]] from the given points, or null
function boundsOf(points) {
  const valid = points.filter((p) => Number.isFinite(Number(p.lat))
    && Number.isFinite(Number(p.lon)));
  if (!valid.length) {
    return null;
  }
  const lons = valid.map((p) => Number(Number(p.lon)));
  const lats = valid.map((p) => Number(Number(p.lat)));
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

function ChartMap(props) {
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
    const bounds = boundsOf(latestRef.current.points);
    const map = new MapLibreMap({
      container: containerRef.current,
      // A mirrored upstream style (corridor downloader manifest, see
      // helpers/charts) carries the full symbology; otherwise a style is
      // generated matching the chart's format
      // A style URL (mirror or mapstyleJSON chart) is set below through
      // setStyle, so its relative URLs can be made absolute first
      style: props.layer.styleUrl ? undefined : mapStyle(props.layer),
      // Requests the style only reaches indirectly (tiles listed inside a
      // source's TileJSON) can still be host-relative: resolve them against
      // the Signal K server, not MapLibre's worker
      transformRequest: (url) => ({ url: absoluteUrl(url) }),
      attributionControl: false,
      // Start zoomed to fit the track instead of MapLibre's world view;
      // MapLibre applies these once the container is measured and the
      // style ready, so slow styles can't leave the map at [0,0]. When
      // there are no points yet (e.g. deep-linking to the map tab before
      // the entry fetch resolves), bounds is null and MapLibre falls
      // back to a neutral world view — the corridor downloader strips
      // the mirrored style's own demo camera, so no uncached tiles are
      // requested before fitBounds runs.
      ...(bounds ? { bounds, fitBoundsOptions: FIT_OPTIONS } : {}),
    });
    mapRef.current = map;
    if (props.layer.styleUrl) {
      map.setStyle(mapStyle(props.layer), {
        transformStyle: (previous, next) => absoluteStyle(next),
      });
    }

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
      // The constructor bounds can be computed against a container that
      // MapLibre hadn't measured yet; re-fit once fully loaded
      const loadedBounds = boundsOf(latestRef.current.points);
      if (loadedBounds) {
        map.fitBounds(loadedBounds, FIT_OPTIONS);
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

  // Zoom back to fit when the point set changes (history fetch resolving
  // grows the bounds past the entry positions) — the old renderer
  // recomputed center/zoom on every render, so refit to match
  useEffect(() => {
    const map = mapRef.current;
    const bounds = boundsOf(props.points);
    if (map && bounds && map.getSource('track')) {
      map.fitBounds(bounds, FIT_OPTIONS);
    }
  }, [props.points]);

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

export default ChartMap;
