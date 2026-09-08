import React, { useState, useEffect } from 'react';
import { Point } from 'where';
import {
  chartLayersWithFallback,
  DEFAULT_LAYER,
  CHART_MIRROR_MANIFEST_URL,
} from '../helpers/charts';
import ChartMap from './ChartMap';

// localStorage key for the chart layer the user last picked, so revisits
// start on the same basemap instead of the first configured chart
const ACTIVE_CHART_LAYER_KEY = 'signalk-logbook:activeChartLayer';

function storedChartLayer() {
  try {
    return window.localStorage.getItem(ACTIVE_CHART_LAYER_KEY);
  } catch (err) {
    // Private browsing can block storage; the selection just won't persist
    return null;
  }
}

function rememberChartLayer(layer) {
  try {
    window.localStorage.setItem(ACTIVE_CHART_LAYER_KEY, layer.identifier);
  } catch (err) {
    // See storedChartLayer
  }
}

function Map(props) {
  // For map we only care about entries with a position
  const entries = props.entries.filter((e) => e.position).map((entry) => ({
    ...entry,
    point: new Point(entry.position.latitude, entry.position.longitude),
    date: new Date(entry.datetime),
  }));
  const [points, setPoints] = useState(entries.map((e) => ({
    lat: e.position.latitude,
    lon: e.position.longitude,
  })));
  // Tile layers come from SignalK's configured charts; `null` until the
  // list resolves (fetching the corridor provider's manifest and the chart
  // resources can take a while), then the list with the OpenStreetMap default
  // always selectable. Rendering nothing while `null` keeps the
  // network-based OpenStreetMap default from loading first. See helpers/charts.
  const [layers, setLayers] = useState(null);
  const [activeLayer, setActiveLayer] = useState(0);
  useEffect(() => {
    // The corridor downloader's asset manifest carries the mirrored
    // upstream chart style (full symbology) when one has been mirrored;
    // chartLayersWithFallback mounts it over the composed vector styles
    const chartsReady = fetch('/signalk/v1/api/resources/charts')
      .then((res) => (res.ok ? res.json() : null));
    const manifestReady = fetch(CHART_MIRROR_MANIFEST_URL)
      .then((res) => (res.ok ? res.json() : null))
      .catch(() => null);
    Promise.all([chartsReady, manifestReady])
      .then(([resource, manifest]) => {
        const available = chartLayersWithFallback(resource, manifest);
        setLayers(available);
        // Restore the chart picked on a previous visit when it is still
        // offered; the list may have changed underneath the stored id
        const remembered = storedChartLayer();
        const rememberedIdx = remembered
          ? available.findIndex((l) => l.identifier === remembered)
          : -1;
        setActiveLayer(rememberedIdx > -1 ? rememberedIdx : 0);
      })
      .catch(() => {
        setLayers([DEFAULT_LAYER]);
      });
  }, []);
  const layer = layers === null ? null : layers[activeLayer] || DEFAULT_LAYER;
  useEffect(() => {
    if (entries.length < 2) {
      return;
    }
    const days = entries.reduce((arr, e) => {
      const date = e.datetime.substr(0, 10);
      if (arr.indexOf(date) === -1) {
        arr.push(date);
      }
      return arr;
    }, []);
    const from = entries[0].datetime;
    const resolution = 300; // Position every 5min
    // History API is v2 and ranges are duration-based (seconds back from
    // now, see /signalk/v2/api/history/values in signalk-history-sqlite)
    const duration = Math.ceil((Date.now() - Date.parse(from)) / 1000);
    fetch(`/signalk/v2/api/history/values?duration=${duration}&paths=navigation.position&resolution=${resolution}`)
      .then((res) => res.json())
      .then((positions) => {
        if (!positions.data || !positions.data.length) {
          return;
        }
        let prev;
        const pts = [];
        positions.data.forEach((d) => {
          if (!d.length) {
            return;
          }
          if (days.indexOf(d[0].substr(0, 10)) === -1) {
            // No entries for this day, skip
            return;
          }
          if (!d[1]) {
            return;
          }
          const point = new Point(d[1][1], d[1][0]);
          if (prev) {
            if (prev.distanceTo(point) < 0.04) {
              return;
            }
          }
          prev = point;
          pts.push({
            lat: point.lat,
            lon: point.lon,
          });
        });
        setPoints(pts);
      })
      .catch(() => {});
  }, [props.entries]);
  const selectLayer = (idx) => {
    setActiveLayer(idx);
    rememberChartLayer(layers[idx]);
  };
  const geoJson = {
    type: 'FeatureCollection',
    features: points.slice(1).map((current, idx) => {
      const previous = points[idx];
      if (!previous
        || Number.isNaN(Number(previous.lat))
        || Number.isNaN(Number(previous.lon))) {
        return null;
      }
      if (!current
        || Number.isNaN(Number(current.lat))
        || Number.isNaN(Number(current.lon))) {
        return null;
      }
      return {
        type: 'feature',
        geometry: {
          type: 'LineString',
          coordinates: [
            [previous.lon, previous.lat],
            [current.lon, current.lat],
          ],
        },
      };
    }).filter((e) => e !== null),
  };
  return (
  <div style={{
    position: 'relative',
    width: '80vw',
    height: '80vh',
  }}>
    {layer === null ? (
      <div style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#666',
      }}>
        Loading charts…
      </div>
    ) : (
    <React.Fragment>
    {layers.length > 1 ? (
      <div style={{
        position: 'absolute',
        zIndex: 400,
        margin: '8px',
        background: 'rgba(255,255,255,0.85)',
        borderRadius: '4px',
        padding: '2px',
      }}>
        {layers.map((l, idx) => (
          <button
            key={l.identifier}
            type="button"
            onClick={() => selectLayer(idx)}
            style={{
              border: 'none',
              margin: '1px',
              padding: '2px 6px',
              cursor: 'pointer',
              borderRadius: '3px',
              background: idx === activeLayer ? '#009bdb' : 'transparent',
              color: idx === activeLayer ? '#fff' : '#333',
            }}
          >
            {l.name}
          </button>
        ))}
      </div>
    ) : null}
    <ChartMap
      key={layer.identifier}
      layer={layer}
      points={points}
      geoJson={geoJson}
      entries={entries}
      viewEntry={props.viewEntry}
    />
    </React.Fragment>
    )}
  </div>
  );
}

export default Map;
