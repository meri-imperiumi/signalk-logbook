const stateToEntry = require('./format');

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
          return appendLog('Motor stopped, sails up');
        }
        return appendLog('Sails up');
      }
      if (value === 'motoring') {
        if (oldState[path] === 'anchored') {
          return appendLog('Motor started, anchor up');
        }
        if (oldState[path] === 'sailing') {
          return appendLog('Motor started, sails down');
        }
        return appendLog('Motor started');
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
