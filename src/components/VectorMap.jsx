import React, { useEffect, useRef } from 'react';
import { Map as MapLibreMap, Marker } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { vectorStyle } from '../helpers/charts';
import { entryMarkerColor } from '../helpers/markers';

// MapLibre GL container for vector tile charts (`format: pbf`/`mvt`), which
// pigeon-maps cannot draw. The chart style is generated from the chart's
// source layers (helpers/charts `vectorStyle`). Track and entry markers are
// drawn to match the raster Map component.
//
// The component is keyed by chart identifier in Map, so a new chart creates a
// fresh instance instead of migrating styles mid-flight.

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
      style: vectorStyle(props.layer),
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
