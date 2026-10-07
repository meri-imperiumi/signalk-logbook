import React, { useState, useEffect } from 'react';
import {
  Row,
  Col,
  Nav,
  NavItem,
  NavLink,
  TabContent,
  TabPane,
  Alert,
} from 'reactstrap';
import Metadata from './Metadata.jsx';
import Timeline from './Timeline.jsx';
import Logbook from './Logbook.jsx';
import Map from './Map.jsx';
import EntryEditor from './EntryEditor.jsx';
import EntryViewer from './EntryViewer.jsx';
import { tabFromHash, hashForTab } from '../helpers/tabs';
import { displayZone, zoneLabel } from '../helpers/timezone';
import {
  DEFAULT_FILTER,
  normalizeFilter,
  isNewStyleFilter,
  filterWindow,
} from '../helpers/range';
import { apiToUiEntry, uiEntryToApi, draftToApiEntry } from '../helpers/entries';
import { loadUnitPreferences, applyDisplayUnits } from '../helpers/units';

const categories = [
  'navigation',
  'engine',
  'radio',
  'maintenance',
];

// Entries are read and written through the Signal K v2 Resources API
// (logentries resource type, provided by this plugin)
const LOGENTRIES_URL = '/signalk/v2/api/resources/logentries';

// Notice under the tab bar for the outcome of the latest entries listing:
// a failure (with any previously loaded entries kept) or a range that
// legitimately holds no entries. The happy case — loaded with content —
// returns null and so takes no space between the tabs and the list
function LoadNotice(props) {
  if (props.loadState === 'error') {
    return (
      <Alert color="warning">
        Loading log entries failed{props.entryCount ? ' — showing the previously loaded entries' : ''}.
      </Alert>
    );
  }
  if (props.loadState === 'loaded' && !props.entryCount) {
    return (
      <Alert color="info">
        No log entries in the selected date range
      </Alert>
    );
  }
  return null;
}

function AppPanel(props) {
  const [data, setData] = useState({
    entries: [],
  });
  // Outcome of the latest entries listing: 'loading' until the first
  // fetch resolves, then 'loaded' or 'error'. Drives the empty-range and
  // failure notices; stays put while a refetch is in flight so the list
  // does not flicker
  const [loadState, setLoadState] = useState('loading');
  const [activeTab, setActiveTab] = useState(
    () => tabFromHash(window.location.hash), // Maybe timeline on mobile, book on desktop?
  );
  const [filter, setFilter] = useState({ ...DEFAULT_FILTER });
  const [editEntry, setEditEntry] = useState(null);
  const [viewEntry, setViewEntry] = useState(null);
  const [addEntry, setAddEntry] = useState(null);
  const [needsUpdate, setNeedsUpdate] = useState(true);
  // True while a save request is in flight: the entry editor disables its
  // Save button so a double-tap cannot fire a second request (each create
  // POST mints a fresh server-side id, so the second tap stores a duplicate)
  const [saving, setSaving] = useState(false);
  // The user's unit preferences (per-user preset override → server-wide
  // active preset), driving how telemetry renders. Null = server has no
  // unitpreferences API; rendering then falls back to nautical units.
  const [unitPrefs, setUnitPrefs] = useState(null);
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

    // One ranged listing instead of a day-file sweep: the window follows
    // the display timezone, entries come back ascending by datetime
    const window = filterWindow(filter, new Date(), displayTimeZone);
    fetch(`${LOGENTRIES_URL}?from=${encodeURIComponent(window.from)}&to=${encodeURIComponent(window.to)}`)
      .then((res) => {
        if (!res.ok) {
          throw new Error(`Log listing failed with ${res.status}`);
        }
        return res.json();
      })
      .then((resources) => {
        const entries = Object.values(resources)
          .map(apiToUiEntry)
          .map((entry) => applyDisplayUnits(entry, unitPrefs));
        setData({
          entries,
        });
        setLoadState('loaded');
        setNeedsUpdate(false);
      })
      .catch(() => {
        // A failed refresh keeps the previously loaded entries instead of
        // blanking the logbook; the notice tells the user, and a later
        // filter, time zone or login change retriggers the load
        setLoadState('error');
        setNeedsUpdate(false);
      });
    return () => {
      clearInterval(interval);
    };
  }, [filter, needsUpdate, loginStatus, displayTimeZone, unitPrefs]);
  // TODO: Depend on chosen time window to reload as needed

  // Unit preferences load once; entries render nautically until they
  // resolve, then re-render through the user's preset
  useEffect(() => {
    loadUnitPreferences().then((prefs) => setUnitPrefs(prefs)).catch(() => setUnitPrefs(null));
  }, []);

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

  // The persisted filter migrates on first load: a filter saved by the
  // pre-quick-range webapp ({ daysToShow: N }) is converted to the matching
  // quick range for the session and written back, so the legacy shape does
  // not linger in applicationData
  useEffect(() => {
    fetch('/signalk/v1/applicationData/user/signalk-logbook/1.0')
      .then((r) => r.json())
      .then((v) => {
        if (!v || !v.filter) {
          return;
        }
        const normalized = normalizeFilter(v.filter);
        setFilter(normalized);
        if (!isNewStyleFilter(v.filter)) {
          fetch('/signalk/v1/applicationData/user/signalk-logbook/1.0', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ filter: normalized }),
          }).catch(() => {});
        }
      })
      .catch(() => {});
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
    if (saving) {
      return;
    }
    setSaving(true);
    // Edits are plain PUTs on the entry's stable resource id — content or
    // datetime alike; the provider preserves the stored datetime when the
    // payload omits it. The logged-in username adopts authorless entries
    // (the ones displaying as "auto"), like the v1 routes did
    fetch(`${LOGENTRIES_URL}/${entry.id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(uiEntryToApi(entry, props.loginStatus.username)),
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
      })
      .catch(() => {
        // Failed edit: keep the editor open so the user can retry
      })
      .finally(() => setSaving(false));
  }

  function saveAddEntry(entry) {
    if (saving) {
      return;
    }
    setSaving(true);
    fetch(LOGENTRIES_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      // The resources API has no request context, so the entry's author
      // must ride in the payload — the username of the logged-in user,
      // exactly what the deprecated v1 routes took from the JWT
      body: JSON.stringify(draftToApiEntry(entry, undefined, props.loginStatus.username)),
    })
      .then(() => {
        setAddEntry(null);
        setNeedsUpdate(true);
      })
      .catch(() => {
        // Failed create: keep the editor open so the user can retry
      })
      .finally(() => setSaving(false));
  }

  function deleteEntry(entry) {
    fetch(`${LOGENTRIES_URL}/${entry.id}`, {
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
        filter={filter}
        displayTimeZone={zoneLabel(displayTimeZone)}
        setFilter={setFilter}
        setNeedsUpdate={setNeedsUpdate}
      />
      <Row>
        { editEntry ? <EntryEditor
          entry={editEntry}
          cancel={() => setEditEntry(null)}
          save={saveEntry}
          delete={deleteEntry}
          saving={saving}
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
          saving={saving}
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
          <LoadNotice loadState={loadState} entryCount={data.entries.length} />
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
