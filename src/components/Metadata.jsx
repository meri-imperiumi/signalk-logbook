import React, { useState, useEffect } from 'react';
import {
  Row,
  Col,
  List,
  ListInlineItem,
  Button,
} from 'reactstrap';
import ordinal from 'ordinal';
import CrewEditor from './CrewEditor.jsx';
import FilterEditor from './FilterEditor.jsx';
import SailEditor from './SailEditor.jsx';

function Metadata(props) {
  const [editSails, setEditSails] = useState(false);
  const [editFilter, setEditFilter] = useState(false);
  const [editCrew, setEditCrew] = useState(false);
  const [crewNames, setCrew] = useState([]);
  const [sails, setSails] = useState([]);
  const paths = [
    'communication.crewNames',
    'sails.inventory.*',
  ];
  const activeSails = sails.filter((s) => s.active);

  function onMessage(m) {
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
          if (JSON.stringify(crewNames) !== JSON.stringify(v.value)) {
            setCrew(v.value);
          }
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
  }

  useEffect(() => {
    let ws;
    fetch('/signalk/v1/api/vessels/self/communication/crewNames')
      .then((r) => r.json(), () => [])
      .then((crew) => {
        if (JSON.stringify(crewNames) !== JSON.stringify(crew.value)) {
          setCrew(crew.value);
          return Promise.reject(new Error('Skip'));
        }
        return fetch('/plugins/sailsconfiguration/sails');
      })
      .then((r) => r.json(), () => [])
      .then((sailSettings) => {
        if (sails.length === 0 && sailSettings.length > 0) {
          setSails(sailSettings);
          return Promise.reject(new Error('Skip'));
        }
        return Promise.resolve();
      })
      .then(() => {
        ws = props.adminUI.openWebsocket({ subscribe: 'none' });
        ws.onopen = () => {
          ws.send(JSON.stringify({
            context: 'vessels.self',
            subscribe: paths.map((path) => ({
              path,
              period: 10000,
            })),
          }));
        };
        ws.onmessage = onMessage;
      })
      .catch(() => {});
    return () => {
      if (!ws) {
        return;
      }
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
  function saveFilter(filter) {
    fetch('/signalk/v1/applicationData/user/signalk-logbook/1.0', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        filter,
      }),
    })
      .then(() => {
        setEditFilter(false);
        props.setDaysToShow(filter.daysToShow);
        // And then reload logs
        props.setNeedsUpdate(true);
      });
  }
  function saveCrew(updatedCrew) {
    fetch('/signalk/v1/api/vessels/self/communication/crewNames', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        value: updatedCrew,
      }),
    })
      .then(() => {
        setEditCrew(false);
        setCrew(updatedCrew);
        setTimeout(() => {
          // We want to reload with a slight delay
          props.setNeedsUpdate(true);
        }, 1000);
      });
  }

  return (
    <Row xs>
    { editCrew ? <CrewEditor
      crewNames={crewNames}
      cancel={() => setEditCrew(false)}
      save={saveCrew}
      username={props.loginStatus.username}
      /> : null }
    { editFilter ? <FilterEditor
      cancel={() => setEditFilter(false)}
      daysToShow={props.daysToShow}
      save={saveFilter}
        /> : null }
    { editSails ? <SailEditor
      sails={sails}
      cancel={() => setEditSails(false)}
      save={saveSails}
        /> : null }
    <Col>
    <List type="unstyled">
    <ListInlineItem><b>Crew</b></ListInlineItem>
    {crewNames.map((crewName) => (
      <ListInlineItem
      key={crewName}
      onClick={() => setEditCrew(true)}
      >{crewName}</ListInlineItem>
    ))}
    {!crewNames.length
        && <Button onClick={() => setEditCrew(true)} size="sm">Edit</Button>
    }
    </List>
    </Col>
    <Col>
        <ListInlineItem><b>Time Zone</b></ListInlineItem>
        <ListInlineItem>{props.displayTimeZone}</ListInlineItem>
    </Col>
    <Col>
      <List type="unstyled">
        <ListInlineItem><b>Show</b></ListInlineItem>
        <ListInlineItem
          onClick={() => setEditFilter(true)}
        >
          Last {props.daysToShow} days
        </ListInlineItem>
      </List>
    </Col>
    <Col className="text-end text-right">
    <List type="unstyled">
    <ListInlineItem><b>Sails</b></ListInlineItem>
    {activeSails.map((sail) => {
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
    {!activeSails.length
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
