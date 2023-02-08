import React, { useState, useEffect } from 'react';
import {
  Row,
  Col,
  Nav,
  NavItem,
  NavLink,
  TabContent,
  TabPane,
} from 'reactstrap';
import Timeline from './Timeline.jsx';
import Logbook from './Logbook.jsx';
import Map from './Map.jsx';
import EntryEditor from './EntryEditor.jsx';
import EntryViewer from './EntryViewer.jsx';
import AddEntry from './AddEntry.jsx';

function AppPanel(props) {
  const [data, setData] = useState({
    entries: [],
  });
  const [activeTab, setActiveTab] = useState('timeline'); // Maybe timeline on mobile, book on desktop?
  const [daysToShow] = useState(7);
  const [editEntry, setEditEntry] = useState(null);
  const [viewEntry, setViewEntry] = useState(null);
  const [addEntry, setAddEntry] = useState(null);
  const [needsUpdate, setNeedsUpdate] = useState(true);

  const loginStatus = props.loginStatus.status;

  useEffect(() => {
    if (!needsUpdate) {
      return;
    }
    if (loginStatus === 'notLoggedIn') {
      // The API only works for authenticated users
      return;
    }
    fetch('/plugins/signalk-logbook/logs')
      .then((res) => res.json())
      .then((days) => {
        const toShow = days.slice(daysToShow * -1);
        Promise.all(toShow.map((day) => fetch(`/plugins/signalk-logbook/logs/${day}`)
          .then((r) => r.json())))
          .then((dayEntries) => {
            const entries = [].concat.apply([], dayEntries); // eslint-disable-line prefer-spread
            setData({
              entries,
            });
            setNeedsUpdate(false);
          });
      });
  }, [daysToShow, needsUpdate, loginStatus]);
  // TODO: Depend on chosen time window to reload as needed

  function saveEntry(entry) {
    const dateString = new Date(entry.datetime).toISOString().substr(0, 10);
    // Sanitize
    const savingEntry = {
      ...entry,
    };
    delete savingEntry.point;
    delete savingEntry.date;
    fetch(`/plugins/signalk-logbook/logs/${dateString}/${entry.datetime}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(savingEntry),
    })
      .then(() => {
        const updatedEntries = [...data.entries];
        const idx = data.entries.findIndex((e) => e.datetime === entry.datetime);
        if (idx !== -1) {
          updatedEntries[idx] = entry;
          setData({
            ...data,
            entries: updatedEntries,
          });
        }
        setEditEntry(null);
        if (viewEntry) {
          // Update viewEntry
          setViewEntry(entry);
        }
      });
  }

  function saveAddEntry(entry) {
    // Sanitize
    const savingEntry = {
      ...entry,
      ago: parseInt(entry.ago, 10),
    };
    fetch('/plugins/signalk-logbook/logs', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(savingEntry),
    })
      .then(() => {
        setAddEntry(null);
        setNeedsUpdate(true);
      });
  }

  if (props.loginStatus.status === 'notLoggedIn' && props.loginStatus.authenticationRequired) {
    return <props.adminUI.Login />;
  }

  return (
    <Row>
      { editEntry ? <EntryEditor
        entry={editEntry}
        cancel={() => setEditEntry(null)}
        save={saveEntry}
        /> : null }
      { viewEntry ? <EntryViewer
        entry={viewEntry}
        editEntry={setEditEntry}
        cancel={() => setViewEntry(null)}
        /> : null }
      { addEntry ? <AddEntry
        entry={addEntry}
        cancel={() => setAddEntry(null)}
        save={saveAddEntry}
        /> : null }
      <Col className="bg-light border">
        <Nav tabs>
          <NavItem>
            <NavLink className={activeTab === 'timeline' ? 'active' : ''} onClick={() => setActiveTab('timeline')}>
              Timeline
            </NavLink>
          </NavItem>
          <NavItem>
            <NavLink className={activeTab === 'book' ? 'active' : ''} onClick={() => setActiveTab('book')}>
              Logbook
            </NavLink>
          </NavItem>
          <NavItem>
            <NavLink className={activeTab === 'map' ? 'active' : ''} onClick={() => setActiveTab('map')}>
              Map
            </NavLink>
          </NavItem>
        </Nav>
        <TabContent activeTab={activeTab}>
          <TabPane tabId="timeline">
            { activeTab === 'timeline' ? <Timeline entries={data.entries} editEntry={setEditEntry} addEntry={() => setAddEntry({})} /> : null }
          </TabPane>
          <TabPane tabId="book">
            { activeTab === 'book' ? <Logbook entries={data.entries} editEntry={setEditEntry} addEntry={() => setAddEntry({})} /> : null }
          </TabPane>
          <TabPane tabId="map">
            { activeTab === 'map' ? <Map entries={data.entries} editEntry={setEditEntry} viewEntry={setViewEntry} /> : null }
          </TabPane>
        </TabContent>
      </Col>
    </Row>
  );
}

export default AppPanel;
