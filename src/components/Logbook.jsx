import React from 'react';
import {
  Table,
  Button,
} from 'reactstrap';
import { Point } from 'where';
import { getOktas } from '../helpers/observations';

function Logbook(props) {
  const entries = props.entries.map((entry) => ({
    ...entry,
    point: new Point(entry.position.latitude, entry.position.longitude),
    date: new Date(entry.datetime),
  }));
  const oktas = getOktas();
  return (
    <div>
      <Table striped hover responsive>
        <thead>
          <tr>
            <th>Time</th>
            <th>Course</th>
            <th>Speed</th>
            <th>Wind</th>
            <th>Baro</th>
            <th>Sea</th>
            <th>Sky</th>
            <th>Coordinates</th>
            <th>Fix</th>
            <th>Log</th>
            <th>Engine</th>
            <th>By</th>
            <th>Remarks</th>
          </tr>
        </thead>
        <tbody>
        {entries.map((entry) => (
          <tr key={entry.datetime} onClick={() => props.editEntry(entry)}>
            <td>{entry.date.toLocaleString('en-GB', { timeZone: 'UTC' })}</td>
            <td>{!Number.isNaN(Number(entry.heading)) ? `${entry.heading}°` : ''}</td>
            <td>{entry.speed.sog}kt</td>
            <td>
              {entry.wind && !Number.isNaN(Number(entry.wind.speed)) ? `${entry.wind.speed}kt ` : ''}
              {entry.wind && !Number.isNaN(Number(entry.wind.direction)) ? `${entry.wind.direction}°` : ''}
            </td>
            <td>{entry.barometer}</td>
            <td>{entry.observations && !Number.isNaN(Number(entry.observations.seaState)) ? entry.observations.seaState : ''}</td>
            <td>{entry.observations && !Number.isNaN(Number(entry.observations.cloudCoverage)) ? oktas[entry.observations.cloudCoverage] : ''}</td>
            <td>{entry.point.toString()}</td>
            <td>{entry.position.source || 'GPS'}</td>
            <td>{!Number.isNaN(Number(entry.log)) ? `${entry.log}NM` : ''}</td>
            <td>{entry.engine && !Number.isNaN(Number(entry.engine.hours)) ? `${entry.engine.hours}h` : ''}</td>
            <td>{entry.author || 'auto'}</td>
            <td>{entry.text}</td>
          </tr>
        ))}
        </tbody>
      </Table>
      <Button color="primary" onClick={props.addEntry}>Add entry</Button>
    </div>
  );
}

export default Logbook;
