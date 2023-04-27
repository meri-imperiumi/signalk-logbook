import React from 'react';
import {
  Table,
  Button,
} from 'reactstrap';
import { Point } from 'where';
import { DateTime } from 'luxon';
import styles from './styles.module.css';

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

function toDateTime(entry, props) {
    return DateTime.fromJSDate(entry.date).setZone(props.displayTimeZone);
}

function entriesForSameDay(entry, previous, props) {
    function sameDay(d1, d2) {
        return d1.hasSame(d2, 'year') && d1.hasSame(d2, 'month') && d1.hasSame(d2, 'day');
    }

    return previous && sameDay(toDateTime(previous, props), toDateTime(entry, props));
}

function toLocaleString(entry, previous, props) {
    const dt = toDateTime(entry, props);

    if (entriesForSameDay(entry, previous, props)) {
        return dt.toLocaleString(DateTime.DATETIME_SHORT_WITH_SECONDS);
    }
    else {
        return `${dt.toLocaleString(DateTime.DATETIME_SHORT_WITH_SECONDS)} (${dt.toLocaleString({ weekday: 'long' })})`;
    }
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
        {entries.map((entry, index) => (
          <tr className={!entriesForSameDay(entry, entries[index-1], props) && styles["new-day"]}
              key={entry.datetime} onClick={() => props.editEntry(entry)}>
            <td>{toLocaleString(entry, entries[index-1], props)}</td>
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
