import React from 'react';
import {
  Card,
  CardBody,
  CardTitle,
  CardSubtitle,
  CardText,
  Table,
} from 'reactstrap';
import { Point } from 'where';

function Timeline(props) {
  const entries = props.entries.map((entry) => ({
    ...entry,
    point: new Point(entry.position.latitude, entry.position.longitude),
    date: new Date(entry.datetime),
  }));
  entries.reverse();
  return (
    <div>
      {entries.map((entry) => (
        <Card key={entry.datetime}>
          <CardBody>
            <CardTitle tag="h5">{entry.date.toLocaleString('en-GB', { timeZone: 'UTC' })}</CardTitle>
            <CardSubtitle tag="h6">{entry.text}</CardSubtitle>
            <CardText>
              <Table borderless>
                <tbody>
                  <tr>
                    <th>Position</th>
                    <td>{entry.point.toString()} {entry.position.source}</td>
                  </tr>
                  <tr>
                    <th>SOG</th>
                    <td>{entry.speed.sog}kt</td>
                  </tr>
                  { entry.heading
                    && <tr>
                      <th>HDG</th>
                      <td>{entry.heading}&deg;</td>
                    </tr>
                  }
                  { entry.wind
                    && <tr>
                      <th>Wind</th>
                      <td>{entry.wind.speed}kt {entry.wind.direction}&deg;</td>
                    </tr>
                  }
                </tbody>
              </Table>
            </CardText>
          </CardBody>
        </Card>
      ))}
    </div>
  );
}

export default Timeline;
