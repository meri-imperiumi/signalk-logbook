import React from 'react';
import {
  Table,
} from 'reactstrap';
import { Point } from 'where';

function Logbook(props) {
  const entries = props.entries.map((entry) => ({
    ...entry,
    point: new Point(entry.position.latitude, entry.position.longitude),
    date: new Date(entry.datetime),
  }));
  return (
    <Table striped hover responsive>
      <thead>
        <tr>
          <th>Time</th>
          <th>Course</th>
          <th>Speed</th>
          <th>Wind</th>
          <th>Baro</th>
          <th>Coordinates</th>
          <th>Fix</th>
          <th>Log</th>
          <th>By</th>
          <th>Remarks</th>
        </tr>
      </thead>
      <tbody>
      {entries.map((entry) => (
        <tr key={entry.datetime} onClick={() => props.editEntry(entry)}>
          <td>{entry.date.toLocaleString('en-GB', { timeZone: 'UTC' })}</td>
          <td>{!Number.isNaN(Number(entry.heading)) ? `${entry.heading}&deg;` : ''}</td>
          <td>{entry.speed.sog}kt</td>
          <td>
            {!Number.isNaN(Number(entry.wind.speed)) ? `${entry.wind.speed}kt` : ''}
            {!Number.isNaN(Number(entry.wind.direction)) ? `${entry.wind.direction}&deg;` : ''}
          </td>
          <td>{entry.barometer}</td>
          <td>{entry.point.toString()}</td>
          <td>{entry.position.source || 'GPS'}</td>
          <td>{!Number.isNaN(Number(entry.log)) ? `${entry.log}NM` : ''}</td>
          <td>{entry.author || 'auto'}</td>
          <td>{entry.text}</td>
        </tr>
      ))}
      </tbody>
    </Table>
  );
}

export default Logbook;
