import React from 'react';
import { Map as PigeonMap, GeoJson, Marker } from 'pigeon-maps';

function Map(props) {
  const position = [props.entries[0].position.latitude, props.entries[0].position.longitude];
  const geoJson = {
    type: 'FeatureCollection',
    features: props.entries.slice(1).map((e, idx) => {
      const previous = props.entries[idx];
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
  <PigeonMap center={position} zoom={8} height={300}>
    <GeoJson
      data={geoJson}
      styleCallback={() => ({
        strokeWidth: '1',
        stroke: 'red',
      })}
    />
    {props.entries.map((entry) => (
    <Marker
      key={entry.datetime}
      anchor={[entry.position.latitude, entry.position.longitude]}>
    </Marker>
    ))}
  </PigeonMap>
  );
}

export default Map;
