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
import styles from './styles.module.css';

function fetchJson(url) {
  return fetch(url)
    .then((r) => {
      if (!r.ok) {
        return [];
      }
      return r.json().catch(() => []);
    })
    .catch(() => []);
}

function mergeSails(prev, sailSettings) {
  if (!Array.isArray(sailSettings) || sailSettings.length === 0) {
    return prev;
  }
  // The sailsconfiguration REST API only provides id, name, and the
  // current state. The full inventory comes via sails.inventory.* deltas
  const merged = sailSettings.map((sail) => {
    const existing = prev.find((s) => s.id === sail.id);
    return existing ? { ...existing, ...sail } : sail;
  });
  const extras = prev.filter((s) => !sailSettings.some((x) => s.id === x.id));
  const next = extras.concat(merged);
  if (JSON.stringify(next) === JSON.stringify(prev)) {
    return prev;
  }
  return next;
}

function Metadata(props) {
  const [editSails, setEditSails] = useState(false);
  const [editFilter, setEditFilter] = useState(false);
  const [editCrew, setEditCrew] = useState(false);
  const [crewNames, setCrew] = useState([]);
  const [onWatch, setOnWatch] = useState(null);
  const [sails, setSails] = useState([]);
  const paths = [
    'communication.crewNames',
    'watch.current',
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
          setCrew((prev) => (
            JSON.stringify(prev) === JSON.stringify(v.value) ? prev : v.value
          ));
          return;
        }
        if (v.path === 'watch.current') {
          setOnWatch((prev) => (
            JSON.stringify(prev) === JSON.stringify(v.value) ? prev : v.value
          ));
          return;
        }
        const matched = v.path.match(/sails\.inventory\.([a-zA-Z0-9]+)/);
        if (matched) {
          setSails((prev) => {
            const newSail = {
              ...v.value,
              id: matched[1],
            };
            const idx = prev.findIndex((s) => s.id === matched[1]);
            if (idx === -1) {
              return [...prev, newSail];
            }
            if (JSON.stringify(newSail) === JSON.stringify(prev[idx])) {
              return prev;
            }
            const updatedSails = [...prev];
            updatedSails[idx] = newSail;
            return updatedSails;
          });
        }
      });
    });
  }

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
    ws.onmessage = onMessage;

    // Seed the current values via REST while waiting for deltas
    fetchJson('/signalk/v1/api/vessels/self/communication/crewNames')
      .then((crew) => {
        const value = crew.value || [];
        setCrew((prev) => (
          JSON.stringify(prev) === JSON.stringify(value) ? prev : value
        ));
      });
    fetchJson('/plugins/sailsconfiguration/sails')
      .then((sailSettings) => {
        setSails((prev) => mergeSails(prev, sailSettings));
      });

    return () => {
      ws.close();
    };
  }, []);

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
      className={(onWatch && onWatch.crewName === crewName) ? styles['on-watch'] : 'idle'}
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
