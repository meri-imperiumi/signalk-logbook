import React, { useState, useEffect } from 'react';

function AppPanel(props) {
  const [data, setData] = useState({
    entries: [],
  });

  useEffect(() => {
    fetch('/plugins/signalk-logbook/logs')
      .then((res) => res.json())
      .then((days) => {
        const toShow = days.slice(-7);
        Promise.all(toShow.map((day) => fetch(`/plugins/signalk-logbook/logs/${day}`)
          .then((r) => r.json())))
          .then((dayEntries) => {
            const entries = [].concat.apply([], dayEntries); // eslint-disable-line prefer-spread
            setData({
              entries,
            });
          });
      });
  });

  // eslint-disable-next-line react/prop-types
  if (props.loginStatus.status === 'notLoggedIn' && props.loginStatus.authenticationRequired) {
    return <props.adminUI.Login />;
  }

  return (
    <div>
      <ul>
      {data.entries.map((item) => (
        <li key={item.datetime}>
        <a href={item.datetime}>{item.text}</a>
        </li>
      ))}
      </ul>
    </div>
  );
}

export default AppPanel;
