import React from 'react';
import {
  Button,
  Card,
  CardHeader,
  Row,
  Col,
  CardBody,
  CardText,
} from 'reactstrap';
import { Point } from 'where';
import EntryDetails from './EntryDetails.jsx';

function Timeline(props) {
  const entries = props.entries.map((entry) => ({
    ...entry,
    point: entry.position ? new Point(entry.position.latitude, entry.position.longitude) : null,
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
                {entry.author || 'auto'}
              </Col>
              <Col className="text-end text-right">
                {entry.date.toLocaleString('en-GB', { timeZone: 'UTC' })}
              </Col>
            </Row>
          </CardHeader>
          <CardBody>
            <CardText>
              <EntryDetails entry={entry} />
            </CardText>
          </CardBody>
        </Card>
      ))}
    </div>
  );
}

export default Timeline;
