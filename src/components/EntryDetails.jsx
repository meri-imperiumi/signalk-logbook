import React from 'react';
import {
  Table,
  Badge,
} from 'reactstrap';
import {
  getSeaStates,
  getOktas,
  getVisibility,
} from '../helpers/observations';

function EntryDetails(props) {
  const { entry } = props;
  const seaStates = getSeaStates();
  const visibility = getVisibility();
  const oktas = getOktas();
  return (
    <div>
      <p>
        {entry.text}
        {' '}
        { entry.category
          && <Badge color='secondary' pill>#{entry.category}</Badge>
        }
        {' '}
        { entry.end
          && <Badge color='secondary' pill>#trip-end</Badge>
        }
      </p>
      <Table borderless striped size="sm">
        <tbody>
          { entry.point
            && <tr>
              <th>Position</th>
              <td>{entry.point.toString()} {entry.position.source || 'GPS'}</td>
            </tr>
          }
          { entry.speed
            && !Number.isNaN(Number(entry.speed.sog))
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
          { entry.observations
            && !Number.isNaN(Number(entry.observations.seaState))
            && <tr>
              <th>Sea</th>
              <td>
                {entry.observations.seaState + 1}
                {': '}
                {seaStates[entry.observations.seaState + 1]}
              </td>
            </tr>
          }
          { entry.observations
            && !Number.isNaN(Number(entry.observations.cloudCoverage))
            && <tr>
              <th>Clouds</th>
              <td>
                {oktas[entry.observations.cloudCoverage]}
                {' '}
                {entry.observations.cloudCoverage}/8
              </td>
            </tr>
          }
          { entry.observations
            && !Number.isNaN(Number(entry.observations.visibility))
            && <tr>
              <th>Visibility</th>
              <td>
                {entry.observations.visibility + 1}
                {': '}
                {visibility[entry.observations.visibility + 1]}
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
          { entry.category === 'radio' && entry.vhf
            && <tr>
              <th>VHF channel</th>
              <td>
                {!Number.isNaN(Number(entry.vhf)) ? `${entry.vhf}` : ''}
              </td>
            </tr>
          }
        </tbody>
      </Table>
    </div>
  );
}

export default EntryDetails;
