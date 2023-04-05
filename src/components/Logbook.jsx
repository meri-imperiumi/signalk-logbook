import React from 'react';
import {
  Table,
  Button,
} from 'reactstrap';
import { Point } from 'where';

function getWeather(entry) {
  const weather = [];
  if (entry.wind) {
    const wind = [];
    if (!Number.isNaN(Number(entry.wind.speed))) {
      wind.push(`${entry.wind.speed}kt`);
    }
    if (!Number.isNaN(Number(entry.wind.direction))) {
      wind.push(`${entry.wind.direction}°`);
    }
    if (wind.length) {
      weather.push(`Wind ${wind.join(' ')}`);
    }
  }
  if (entry.observations) {
    if (!Number.isNaN(Number(entry.observations.seaState))) {
      weather.push(`Sea state ${entry.observations.seaState}`);
    }
    if (!Number.isNaN(Number(entry.observations.cloudCoverage))) {
      weather.push(`Clouds ${entry.observations.cloudCoverage}/8`);
    }
    if (!Number.isNaN(Number(entry.observations.visibility))) {
      weather.push(`Visibility ${entry.observations.visibility + 1}`);
    }
  }
  return weather.join(', ');
}

function getCourse(entry) {
  if (!Number.isNaN(Number(entry.course))) {
    return `${entry.course}°`;
  }
  if (!Number.isNaN(Number(entry.heading))) {
    return `HDT ${entry.heading}°`;
  }
  return '';
}

function Logbook(props) {
  const entries = props.entries.map((entry) => ({
    ...entry,
    point: entry.position ? new Point(entry.position.latitude, entry.position.longitude) : null,
    date: new Date(entry.datetime),
  }));
  return (
    <div>
      <Table striped hover responsive>
        <thead>
          <tr>
            <th>Time</th>
            <th>Course</th>
            <th>Speed</th>
            <th>Weather</th>
            <th>Baro</th>
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
            <td>{entry.date.toLocaleString('en-GB', {
              timeZone: props.displayTimeZone,
            })}</td>
            <td>{getCourse(entry)}</td>
            <td>{entry.speed && !Number.isNaN(Number(entry.speed.sog)) ? `${entry.speed.sog}kt` : ''}</td>
            <td>{getWeather(entry)}</td>
            <td>{entry.barometer}</td>
            <td>{entry.point ? entry.point.toString() : 'n/a'}</td>
            <td>{entry.position ? entry.position.source || 'GPS' : ''}</td>
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
