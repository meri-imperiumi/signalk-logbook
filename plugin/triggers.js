const ordinal = require('ordinal');
const stateToEntry = require('./format');

function isUnderWay(state) {
  if (state['navigation.state'] === 'sailing') {
    return true;
  }
  if (state['navigation.state'] === 'motoring') {
    return true;
  }
  return false;
}

function sailsString(state, app) {
  const string = [];
  Object.keys(state).forEach((path) => {
    const matched = path.match(/sails\.inventory\.([a-zA-Z0-9]+)/);
    if (!matched) {
      return;
    }
    // Since the sail updates arrive asynchronously, read from app directly
    // to ensure canonical state
    const sailState = app.getSelfPath(path).value;
    const sail = {
      ...sailState,
      id: matched[1],
    };
    if (!sail.active) {
      return;
    }
    if (sail.reducedState && sail.reducedState.reefs) {
      string.push(`${sail.name} (${ordinal(sail.reducedState.reefs)} reef)`);
      return;
    }
    if (sail.reducedState && sail.reducedState.furledRatio) {
      string.push(`${sail.name} (${sail.reducedState.furledRatio * 100}% furled)`);
      return;
    }
    string.push(sail.name);
  });
  return string.join(', ');
}

exports.processTriggers = function processTriggers(path, value, oldState, log, app) {
  function appendLog(text, additionalData = {}) {
    const data = stateToEntry(oldState, text);
    Object.keys(additionalData).forEach((key) => {
      data[key] = additionalData[key];
    });
    if (!data.category) {
      data.category = 'navigation';
    }
    const dateString = new Date(data.datetime).toISOString().substr(0, 10);
    return log.appendEntry(dateString, data)
      .then(() => {
        app.setPluginStatus(`Automatic log entry: ${text}`);
        return null;
      });
  }

  switch (path) {
    case 'steering.autopilot.state': {
      if (oldState[path] === value || !oldState[path]) {
        // We can ignore state when it doesn't change
        return Promise.resolve();
      }
      if (!isUnderWay(oldState)) {
        // Autopilot state changes are likely not interesting when not under way
        return Promise.resolve();
      }
      if (value === 'auto') {
        return appendLog('Autopilot activated');
      }
      if (value === 'wind') {
        return appendLog('Autopilot set to wind mode');
      }
      if (value === 'route') {
        return appendLog('Autopilot set to route mode');
      }
      if (value === 'standby') {
        return appendLog('Autopilot deactivated');
      }
      break;
    }
    case 'navigation.state': {
      if (oldState[path] === value || !oldState[path]) {
        // We can ignore state when it doesn't change
        return Promise.resolve();
      }
      if (value === 'anchored') {
        return appendLog('Anchored', {
          end: true,
        });
      }
      if (value === 'sailing') {
        let text = '';
        if (oldState[path] === 'motoring') {
          text = 'Motor stopped, sailing';
          if (oldState['custom.logbook.sails']) {
            text = `${text} with ${oldState['custom.logbook.sails']}`;
          }
          return appendLog(text);
        }
        text = 'Sailing';
        if (oldState['custom.logbook.sails']) {
          text = `${text} with ${oldState['custom.logbook.sails']}`;
        }
        return appendLog(text);
      }
      if (value === 'motoring') {
        if (oldState[path] === 'anchored') {
          return appendLog('Anchor up, motoring');
        }
        if (oldState[path] === 'sailing') {
          return appendLog('Sails down, motoring');
        }
        return appendLog('Motoring');
      }
      if (value === 'moored') {
        return appendLog('Stopped', {
          end: true,
        });
      }
      break;
    }
    case 'communication.crewNames': {
      if (!oldState[path] || !oldState[path].length) {
        return Promise.resolve();
      }
      if (!value || !value.length) {
        return Promise.resolve();
      }
      if (JSON.stringify(oldState[path]) === JSON.stringify(path)) {
        return Promise.resolve();
      }
      const added = value.filter((v) => oldState[path].indexOf(v) === -1);
      const removed = oldState[path].filter((v) => value.indexOf(v) === -1);
      if (added.length && removed.length) {
        return appendLog(`Crew changed to ${value.join(', ')}`);
      }
      if (added.length) {
        return appendLog(`${added.join(', ')} joined the crew`);
      }
      if (removed.length) {
        return appendLog(`${removed.join(', ')} left the crew`);
      }
      break;
    }
    default: {
      break;
    }
  }

  const propulsionState = path.match(/propulsion\.([A-Za-z0-9]+)\.state/);
  if (propulsionState) {
    if (oldState[path] === value || !oldState[path]) {
      // We can ignore state when it doesn't change
      return Promise.resolve();
    }
    const engineName = propulsionState[1];
    if (value === 'started') {
      return appendLog(`Started ${engineName} engine`);
    }
    if (value === 'stopped') {
      return appendLog(`Stopped ${engineName} engine`);
    }
  }

  const sailState = path.match(/sails\.inventory\.([a-zA-Z0-9]+)/);
  if (sailState) {
    const sails = {
      ...oldState,
    };
    sails[path] = value;
    const sailsCombined = sailsString(sails, app);
    const stateUpdates = {
      'custom.logbook.sails': sailsCombined,
    };
    if (!oldState['custom.logbook.sails']) {
      return Promise.resolve(stateUpdates);
    }
    if (oldState['custom.logbook.sails'] === sailsCombined) {
      return Promise.resolve(null);
    }
    if (oldState['navigation.state'] === 'sailing') {
      return appendLog(`Sails set: ${sailsCombined}`)
        .then(() => stateUpdates);
    }
    return Promise.resolve(stateUpdates);
  }

  return Promise.resolve();
};

exports.processHourly = function processHourly(oldState, log, app) {
  if (oldState['navigation.state'] !== 'sailing' && oldState['navigation.state'] !== 'motoring') {
    return Promise.resolve();
  }
  const data = stateToEntry(oldState, '');
  const dateString = new Date(data.datetime).toISOString().substr(0, 10);
  return log.appendEntry(dateString, data)
    .then(() => {
      app.setPluginStatus('Automatic hourly log entry');
    });
};
