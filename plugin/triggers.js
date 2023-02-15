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
        if (oldState[path] === 'motoring') {
          return appendLog('Motor stopped, sailing');
        }
        return appendLog('Sailing');
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
    default: {
      break;
    }
  }

  const propulsionState = path.match(/propulsion\.[A-Za-z0-9]+\.state/);
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
