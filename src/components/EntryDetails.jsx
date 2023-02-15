import React from 'react';
import {
  Table,
} from 'reactstrap';

function EntryDetails(props) {
  const { entry } = props;
  return (
    <div>
      <p>
        {entry.text}
        {entry.category ? ` #${entry.category}` : ''}
      </p>
      <Table borderless striped size="sm">
        <tbody>
          <tr>
            <th>Position</th>
            <td>{entry.point.toString()} {entry.position.source}</td>
          </tr>
          { !Number.isNaN(Number(entry.speed.sog))
            && <tr>
            <th>Speed</th>
            <td>{entry.speed.sog}kt</td>
            </tr>
          }
          { !Number.isNaN(Number(entry.heading))
            && <tr>
              <th>Course</th>
              <td>{entry.heading}°</td>
            </tr>
          }
          { entry.wind
            && <tr>
              <th>Wind</th>
              <td>
                {!Number.isNaN(Number(entry.wind.speed)) ? `${entry.wind.speed}kt ` : ''}
                {!Number.isNaN(Number(entry.wind.direction)) ? `${entry.wind.direction}°` : ''}
              </td>
            </tr>
          }
          { entry.category === 'engine' && entry.engine
            && <tr>
              <th>Engine</th>
              <td>
                {!Number.isNaN(Number(entry.engine.hours)) ? `${entry.engine.hours}h ` : ''}
              </td>
            </tr>
          }
        </tbody>
      </Table>
    </div>
  );
}

export default EntryDetails;
