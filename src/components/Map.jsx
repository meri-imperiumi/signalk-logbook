import React, { useState, useEffect, useRef } from 'react';
import { Map as PigeonMap, GeoJson, Marker } from 'pigeon-maps';
import { Point } from 'where';
import { viewport } from '@mapbox/geo-viewport';

function calculateBounds(points) {
  if (!points.length) {
    return [0, 0, 0, 0];
  }
  const x = points.map((xy) => xy.lon);
  const y = points.map((xy) => xy.lat);
  return [
    Math.min(...y),
    Math.min(...x),
    Math.max(...y),
    Math.max(...x),
  ];
}

function Map(props) {
  const entries = props.entries.map((entry) => ({
    ...entry,
    point: new Point(entry.position.latitude, entry.position.longitude),
    date: new Date(entry.datetime),
  }));
  const [points, setPoints] = useState(entries.map((e) => ({
    lat: e.position.latitude,
    lon: e.position.longitude,
  })));
  const [bbox, setBbox] = useState([640, 480]);
  const mapContainer = useRef(null);
  useEffect(() => {
    if (!mapContainer.current) {
      return;
    }
    const rect = mapContainer.current.getBoundingClientRect();
    setBbox([rect.width, rect.height]);
  }, []);
  const centerAndZoom = viewport(calculateBounds(points), bbox);
  centerAndZoom.zoom -= 1.5;
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
    const to = entries[entries.length - 1].datetime;
    const resolution = 600; // Position every 10min
    fetch(`/signalk/v1/history/values?from=${from}&to=${to}&paths=navigation.position&resolution=${resolution}`)
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
  <div ref={mapContainer} style={{
    width: '80vw',
    height: '80vh',
  }}>
    <PigeonMap
      center={centerAndZoom.center}
      zoom={centerAndZoom.zoom}
    >
      <GeoJson
        data={geoJson}
        styleCallback={() => ({
          strokeWidth: '1',
          stroke: 'red',
        })}
      />
      {entries.map((entry) => {
        let color = '#009bdb';
        if (entry.category === 'engine') {
          color = '#ed1b2f';
        }
        if (entry.category === 'radio') {
          color = '#00ae9d';
        }
        return (
        <Marker
          key={entry.datetime}
          color={color}
          anchor={[entry.position.latitude, entry.position.longitude]}
          onClick={() => props.viewEntry(entry)} />
        );
      })}
    </PigeonMap>
  </div>
  );
}

export default Map;
