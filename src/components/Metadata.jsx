import React, { useState, useEffect } from 'react';
import {
  Row,
  Col,
  List,
  ListInlineItem,
  Button,
} from 'reactstrap';
import ordinal from 'ordinal';
import SailEditor from './SailEditor.jsx';

function Metadata(props) {
  const [editSails, setEditSails] = useState(false);
  const [crewNames, setCrew] = useState([]);
  const [sails, setSails] = useState([]);
  const paths = [
    'communication.crewNames',
    'sails.inventory.*',
  ];
  useEffect(() => {
    const ws = props.adminUI.openWebsocket({ subscribe: 'none' });
    ws.onopen = () => {
      ws.send(JSON.stringify({
        context: 'vessels.self',
        subscribe: paths.map((path) => ({
          path,
          period: 10000,
        })),
      }));
    };
    ws.onmessage = (m) => {
      const delta = JSON.parse(m.data);
      if (!delta.updates) {
        return;
      }
      delta.updates.forEach((u) => {
        if (!u.values) {
          return;
        }
        u.values.forEach((v) => {
          if (v.path === 'communication.crewNames') {
            setCrew(v.value);
            return;
          }
          const updatedSails = [...sails];
          const matched = v.path.match(/sails\.inventory\.([a-zA-Z0-9]+)/);
          if (matched) {
            const newSail = {
              ...v.value,
              id: matched[1],
            };
            const idx = updatedSails.findIndex((s) => s.id === matched[1]);
            if (idx === -1) {
              updatedSails.push(newSail);
              setSails(updatedSails);
              return;
            }
            if (JSON.stringify(newSail) === JSON.stringify(updatedSails[idx])) {
              return;
            }
            updatedSails[idx] = newSail;
            setSails(updatedSails);
          }
        });
      });
    };
    return () => {
      ws.close();
    };
  }, [sails, crewNames]);

  function saveSails(updatedSails) {
    const payload = updatedSails.map((s) => ({
      id: s.id,
      active: s.active,
      reducedState: s.reducedState,
    }));
    fetch('/plugins/sailsconfiguration/sails', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })
      .then(() => {
        setEditSails(false);
        setSails(updatedSails);
        setTimeout(() => {
          // We want to reload with a slight delay
          props.setNeedsUpdate(true);
        }, 1000);
      });
  }

  return (
    <Row xs>
      { editSails ? <SailEditor
        sails={sails}
        cancel={() => setEditSails(false)}
        save={saveSails}
        /> : null }
      <Col>
        <List type="unstyled">
          <ListInlineItem><b>Crew</b></ListInlineItem>
          {crewNames.map((crewName) => (
            <ListInlineItem key={crewName}>{crewName}</ListInlineItem>
          ))}
          {!crewNames.length
            && <ListInlineItem>No crew set</ListInlineItem>
          }
        </List>
      </Col>
      <Col className="text-end text-right">
        <List type="unstyled">
          <ListInlineItem><b>Sails</b></ListInlineItem>
          {sails.map((sail) => {
            if (!sail.active) {
              return '';
            }
            let reduced = '';
            if (sail.reducedState && sail.reducedState.reefs) {
              reduced = ` (${ordinal(sail.reducedState.reefs)} reef)`;
            }
            if (sail.reducedState && sail.reducedState.furledRatio) {
              reduced = ` (${sail.reducedState.furledRatio * 100}% furled)`;
            }
            return (
              <ListInlineItem
                key={sail.id}
                onClick={() => setEditSails(true)}
              >
                {sail.name}{reduced}
              </ListInlineItem>
            );
          })}
          {!sails.length
            && <Button
                onClick={() => setEditSails(true)}
               >
              Edit
              </Button>
          }
        </List>
      </Col>
    </Row>
  );
}

export default Metadata;
