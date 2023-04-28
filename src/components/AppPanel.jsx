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
import Metadata from './Metadata.jsx';
import Timeline from './Timeline.jsx';
import Logbook from './Logbook.jsx';
import Map from './Map.jsx';
import EntryEditor from './EntryEditor.jsx';
import EntryViewer from './EntryViewer.jsx';

const categories = [
  'navigation',
  'engine',
  'radio',
  'maintenance',
];

function AppPanel(props) {
  const [data, setData] = useState({
    entries: [],
  });
  const [activeTab, setActiveTab] = useState('timeline'); // Maybe timeline on mobile, book on desktop?
  const [daysToShow, setDaysToShow] = useState(7);
  const [editEntry, setEditEntry] = useState(null);
  const [viewEntry, setViewEntry] = useState(null);
  const [addEntry, setAddEntry] = useState(null);
  const [needsUpdate, setNeedsUpdate] = useState(true);
  const [timezone, setTimezone] = useState('UTC');

  const loginStatus = props.loginStatus.status;

  useEffect(() => {
    if (!needsUpdate) {
      return undefined;
    }
    if (loginStatus === 'notLoggedIn') {
      // The API only works for authenticated users
      return undefined;
    }

    // We'll want to re-fetch logs periodically
    const interval = setInterval(() => {
      setNeedsUpdate(true);
    }, 5 * 60000);

    fetch('/plugins/signalk-logbook/logs')
      .then((res) => res.json())
      .then((days) => {
        const showFrom = new Date();
        showFrom.setDate(showFrom.getDate() - daysToShow);
        const toShow = days.filter((d) => d >= showFrom.toISOString().substr(0, 10));
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
    return () => {
      clearInterval(interval);
    };
  }, [daysToShow, needsUpdate, loginStatus]);
  // TODO: Depend on chosen time window to reload as needed

  useEffect(() => {
    fetch('/signalk/v1/applicationData/user/signalk-logbook/1.0')
      .then((r) => r.json())
      .then((v) => {
        if (v && v.filter && v.filter.daysToShow) {
          setDaysToShow(v.filter.daysToShow);
        }
      });
  }, [loginStatus]);

  useEffect(() => {
    fetch('/plugins/signalk-logbook/config')
      .then((r) => r.json())
      .then((v) => {
        if (!v.configuration) {
          return;
        }
        if (v.configuration.displayTimeZone) {
          setTimezone(v.configuration.displayTimeZone);
        }
      });
  }, [timezone]);

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

  function deleteEntry(entry) {
    const dateString = new Date(entry.datetime).toISOString().substr(0, 10);
    fetch(`/plugins/signalk-logbook/logs/${dateString}/${entry.datetime}`, {
      method: 'DELETE',
    })
      .then(() => {
        setEditEntry(null);
        setNeedsUpdate(true);
      });
  }

  if (props.loginStatus.status === 'notLoggedIn' && props.loginStatus.authenticationRequired) {
    return <props.adminUI.Login />;
  }

  return (
    <div>
      <Metadata
        adminUI={props.adminUI}
        loginStatus={props.loginStatus}
        daysToShow={daysToShow}
        displayTimeZone={timezone}
        setDaysToShow={setDaysToShow}
        setNeedsUpdate={setNeedsUpdate}
      />
      <Row>
        { editEntry ? <EntryEditor
          entry={editEntry}
          cancel={() => setEditEntry(null)}
          save={saveEntry}
          delete={deleteEntry}
          categories={categories}
          displayTimeZone={timezone}
          /> : null }
        { viewEntry ? <EntryViewer
          entry={viewEntry}
          editEntry={setEditEntry}
          cancel={() => setViewEntry(null)}
          categories={categories}
          displayTimeZone={timezone}
          /> : null }
        { addEntry ? <EntryEditor
          entry={addEntry}
          cancel={() => setAddEntry(null)}
          save={saveAddEntry}
          categories={categories}
          /> : null }
        <Col className="bg-light border">
          <Nav tabs>
            <NavItem>
              <NavLink className={activeTab === 'timeline' ? 'active' : ''} onClick={() => setActiveTab('timeline')}>
                Timeline
              </NavLink>
            </NavItem>
            <NavItem>
              <NavLink className={activeTab === 'book' ? 'active' : ''} onClick={() => {
                setActiveTab('book');
                props.adminUI.hideSideBar();
              }}>
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
              { activeTab === 'timeline' ? <Timeline entries={data.entries} displayTimeZone={timezone} editEntry={setEditEntry} addEntry={() => setAddEntry({ ago: 0, category: 'navigation' })} /> : null }
            </TabPane>
            <TabPane tabId="book">
              { activeTab === 'book' ? <Logbook entries={data.entries} displayTimeZone={timezone} editEntry={setEditEntry} addEntry={() => setAddEntry({ ago: 0, category: 'navigation' })} /> : null }
            </TabPane>
            <TabPane tabId="map">
              { activeTab === 'map' ? <Map entries={data.entries} editEntry={setEditEntry} viewEntry={setViewEntry} /> : null }
            </TabPane>
          </TabContent>
        </Col>
      </Row>
    </div>
  );
}

export default AppPanel;
