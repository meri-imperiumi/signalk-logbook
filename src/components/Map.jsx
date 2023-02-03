import React from 'react';
import { Map as PigeonMap, Marker } from 'pigeon-maps';

function Map(props) {
  const position = [props.entries[0].position.latitude, props.entries[0].position.longitude];
  return (
  <PigeonMap center={position} zoom={8} height={300}>
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
