import React from 'react';

import {
  Map as MapContainer,
  TileLayer,
  Marker,
  Popup,
} from 'react-leaflet';

function Map(props) {
  const position = [props.entries[0].position.latitude, props.entries[0].position.longitude];
  return (
  <MapContainer center={position} zoom={8} scrollWheelZoom={false}>
    <TileLayer
      attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
      url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
    />
    {props.entries.map((entry) => (
    <Marker
      key={entry.datetime}
      position={[entry.position.latitude, entry.position.longitude]}>
      <Popup>
        { entry.text}
      </Popup>
    </Marker>
    ))}
  </MapContainer>
  );
}

export default Map;
