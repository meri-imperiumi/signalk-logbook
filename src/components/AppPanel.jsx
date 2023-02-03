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

function AppPanel(props) {
  const [data, setData] = useState({
    entries: [],
  });
  const [activeTab, setActiveTab] = useState('timeline'); // Maybe timeline on mobile, book on desktop?
  const [daysToShow] = useState(7);

  useEffect(() => {
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
          });
      });
  }, [daysToShow]); // TODO: Depend on chosen time window to reload as needed

  if (props.loginStatus.status === 'notLoggedIn' && props.loginStatus.authenticationRequired) {
    return <props.adminUI.Login />;
  }

  return (
    <Row>
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
            { activeTab === 'timeline' ? <Timeline entries={data.entries} /> : null }
          </TabPane>
          <TabPane tabId="book">
            Logbook table goes here
          </TabPane>
          <TabPane tabId="map">
            Map goes here
          </TabPane>
        </TabContent>
      </Col>
    </Row>
  );
}

export default AppPanel;
