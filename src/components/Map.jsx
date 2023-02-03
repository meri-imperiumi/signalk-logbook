import React from 'react';
import { Map as PigeonMap, GeoJson, Marker } from 'pigeon-maps';
import { Point } from 'where';

function Map(props) {
  const entries = props.entries.map((entry) => ({
    ...entry,
    point: new Point(entry.position.latitude, entry.position.longitude),
    date: new Date(entry.datetime),
  }));
  const position = [entries[0].position.latitude, entries[0].position.longitude];
  const geoJson = {
    type: 'FeatureCollection',
    features: entries.slice(1).map((e, idx) => {
      const previous = entries[idx];
      if (!previous) {
        return null;
      }
      if (!e.position) {
        return null;
      }
      return {
        type: 'feature',
        geometry: {
          type: 'LineString',
          coordinates: [
            [previous.position.longitude, previous.position.latitude],
            [e.position.longitude, e.position.latitude],
          ],
        },
      };
    }).filter((e) => e !== null),
  };
  return (
  <PigeonMap center={position} zoom={8} height='80vh'>
    <GeoJson
      data={geoJson}
      styleCallback={() => ({
        strokeWidth: '1',
        stroke: 'red',
      })}
    />
    {entries.map((entry) => (
    <Marker
      key={entry.datetime}
      anchor={[entry.position.latitude, entry.position.longitude]}
      onClick={() => props.viewEntry(entry)} />
    ))}
  </PigeonMap>
  );
}

export default Map;
