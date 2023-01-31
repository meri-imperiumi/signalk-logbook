const { join } = require('path');
const CircularBuffer = require('circular-buffer');

function getLogName() {
  const dateString = new Date().toISOString();
  return dateString.substr(0, 10);
}

module.exports = (app) => {
  const plugin = {};
  let unsubscribes = [];
  let interval;

  plugin.id = 'signalk-logbook';
  plugin.name = 'Logbook';
  plugin.description = 'Semi-automatic logbook for sailing vessels';

  const setStatus = app.setPluginStatus || app.setProviderStatus;

  // The paths we want to listen and collect data for
  const paths = [
    'navigation.state',    // Under way/stopped
    'navigation.datetime', // Current time, for automated hourly entries
    'navigation.position',
    'navigation.gnss.type',
    'navigation.headingTrue',
    'navigation.speedThroughWater',
    'navigation.speedOverGround',
    'navigation.trip.log',
    'navigation.courseRhumbline.nextPoint.position',
    'environment.outside.pressure',
    'environment.wind.directionTrue',
    'environment.wind.speedOverGround',
    'environment.water.swell.state',
    'propulsion.*.state',
    'propulsion.*.revolutions',
    'sails.inventory.*',
  ];

  // We keep 15min of past state to allow slight backdating of entries
  const buffer = new CircularBuffer(15);

  let state = {};

  function getLogPath(logName) {
    return join(app.getDataDirPath(), `${logName}.yml`);
  }
  plugin.start = (options) => {
    const subscription = {
      context: 'vessels.self',
      subscribe: paths.map((p) => ({
        path: p,
        period: 30000, // For logbook purposes, date update per minute is enough
      })),
    };
    app.subscriptionmanager.subscribe(
      subscription,
      unsubscribes,
      (subscriptionError) => {
        app.error(`Error:${subscriptionError}`);
      },
      (delta) => {
        if (!delta.updates) {
          return;
        }
        delta.updates.forEach((u) => {
          if (!u.values) {
            return;
          }
          u.values.forEach((v) => {
            state[v.path] = v.value;
          });
        });
      },
    );

    interval = setInterval(() => {
      // Save old state to buffer
      buffer.enq(state);
      // We can keep a clone of the previous values
      state = {
        ...state,
      };
      console.log(buffer.toarray());
    }, 60000);

    setStatus('Waiting for updates');
  };

  plugin.stop = () => {
    unsubscribes.forEach((f) => f());
    unsubscribes = [];
    clearInterval(interval);
  };

  plugin.schema = {};

  return plugin;
};
