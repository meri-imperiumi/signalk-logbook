import React from 'react';
import {
  Button,
  Card,
  CardHeader,
  Row,
  Col,
  CardBody,
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
      <Button color="primary" onClick={props.addEntry}>Add entry</Button>
      {entries.map((entry) => (
        <Card key={entry.datetime} onClick={() => props.editEntry(entry)}>
          <CardHeader>
            <Row>
              <Col xs="3">
                @{entry.author || 'auto'}
              </Col>
              <Col className="text-end text-right">
                {entry.date.toLocaleString('en-GB', { timeZone: 'UTC' })}
              </Col>
            </Row>
          </CardHeader>
          <CardBody>
            <CardText>
              <p>
                {entry.text}
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
