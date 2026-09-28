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
import { tabFromHash, hashForTab } from '../helpers/tabs';
import { displayZone, showFromKey, zoneLabel } from '../helpers/timezone';

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
  const [activeTab, setActiveTab] = useState(
    () => tabFromHash(window.location.hash), // Maybe timeline on mobile, book on desktop?
  );
  const [daysToShow, setDaysToShow] = useState(7);
  const [editEntry, setEditEntry] = useState(null);
  const [viewEntry, setViewEntry] = useState(null);
  const [addEntry, setAddEntry] = useState(null);
  const [needsUpdate, setNeedsUpdate] = useState(true);
  const [timezone, setTimezone] = useState('UTC');
  // Ship's time offset from environment.time.timezoneOffset, published
  // by signalk-ships-time in (-)hhmm encoding, e.g. 1300 → UTC+13
  const [timezoneOffset, setTimezoneOffset] = useState(null);

  const loginStatus = props.loginStatus.status;

  // Concrete zone the logbook renders in: UTC or the live ship's time.
  // Storage stays UTC either way, this only drives display.
  const displayTimeZone = displayZone(timezone, timezoneOffset);

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
        const showFrom = showFromKey(new Date(), displayTimeZone, daysToShow);
        const toShow = days.filter((d) => d >= showFrom);
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
  }, [daysToShow, needsUpdate, loginStatus, displayTimeZone]);
  // TODO: Depend on chosen time window to reload as needed

  // Ship's time offset deltas, used when the display time zone setting
  // is ship's time
  useEffect(() => {
    const ws = props.adminUI.openWebsocket({ subscribe: 'none' });
    ws.onopen = () => {
      ws.send(JSON.stringify({
        context: 'vessels.self',
        subscribe: [
          {
            path: 'environment.time.timezoneOffset',
            period: 10000,
          },
        ],
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
          if (v.path === 'environment.time.timezoneOffset' && Number.isFinite(v.value)) {
            setTimezoneOffset(v.value);
          }
        });
      });
    };
    // Seed the current offset via REST while waiting for deltas
    fetch('/signalk/v1/api/vessels/self/environment/time/timezoneOffset')
      .then((r) => (r.ok ? r.json() : null))
      .then((v) => {
        if (v && Number.isFinite(v.value)) {
          setTimezoneOffset(v.value);
        }
      })
      .catch(() => {});
    return () => {
      ws.close();
    };
  }, []);

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

  // The logbook UI is embedded in the Signal K admin app, which routes on
  // the URL hash (the logbook webapp lives at '#/e/_meri_imperiumi_signalk_logbook').
  // The tab is stored in the hash's query string so the admin route is left
  // untouched; a bare '#book' would navigate the admin app to a nonexistent
  // route and blank the whole webapp. See helpers/tabs.
  useEffect(() => {
    function onHashChange() {
      setActiveTab(tabFromHash(window.location.hash));
    }
    window.addEventListener('hashchange', onHashChange);
    return () => {
      window.removeEventListener('hashchange', onHashChange);
    };
  }, []);

  function selectTab(tab) {
    setActiveTab(tab);
    const target = hashForTab(tab, window.location.hash);
    if (window.location.hash !== target) {
      window.location.hash = target;
    }
  }

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
        displayTimeZone={zoneLabel(displayTimeZone)}
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
          displayTimeZone={displayTimeZone}
          /> : null }
        { viewEntry ? <EntryViewer
          entry={viewEntry}
          editEntry={setEditEntry}
          cancel={() => setViewEntry(null)}
          categories={categories}
          displayTimeZone={displayTimeZone}
          /> : null }
        { addEntry ? <EntryEditor
          entry={addEntry}
          isNew={true}
          cancel={() => setAddEntry(null)}
          save={saveAddEntry}
          categories={categories}
          displayTimeZone={displayTimeZone}
          /> : null }
        <Col className="bg-light border">
          <Nav tabs>
            <NavItem>
              <NavLink className={activeTab === 'timeline' ? 'active' : ''} onClick={() => selectTab('timeline')}>
                Timeline
              </NavLink>
            </NavItem>
            <NavItem>
              <NavLink className={activeTab === 'book' ? 'active' : ''} onClick={() => {
                selectTab('book');
                props.adminUI.hideSideBar();
              }}>
                Logbook
              </NavLink>
            </NavItem>
            <NavItem>
              <NavLink className={activeTab === 'map' ? 'active' : ''} onClick={() => selectTab('map')}>
                Map
              </NavLink>
            </NavItem>
          </Nav>
          <TabContent activeTab={activeTab}>
            <TabPane tabId="timeline">
              { activeTab === 'timeline' ? <Timeline entries={data.entries} displayTimeZone={displayTimeZone} editEntry={setEditEntry} addEntry={() => setAddEntry({ ago: 0, category: 'navigation' })} /> : null }
            </TabPane>
            <TabPane tabId="book">
              { activeTab === 'book' ? <Logbook entries={data.entries} displayTimeZone={displayTimeZone} editEntry={setEditEntry} addEntry={() => setAddEntry({ ago: 0, category: 'navigation' })} /> : null }
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
