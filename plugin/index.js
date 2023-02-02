const CircularBuffer = require('circular-buffer');
const Log = require('./Log');

function rad2deg(rad) {
  return Math.round((rad * 180) / Math.PI);
}

function ms2kt(ms) {
  return parseFloat((ms * 1.94384).toFixed(1));
}

function stateToEntry(state, text) {
  const data = {
    datetime: new Date(state['navigation.datetime']) || new Date(),
    position: {
      ...state['navigation.position'],
      source: state['navigation.gnss.type'] || 'GPS',
    },
    heading: rad2deg(state['navigation.headingTrue']),
    speed: {
      stw: ms2kt(state['navigation.speedThroughWater']),
      sog: ms2kt(state['navigation.speedOverGround']),
    },
    log: parseFloat((state['navigation.trip.log'] / 1852).toFixed(1)),
    waypoint: state['navigation.courseRhumbline.nextPoint.position'],
    barometer: parseFloat((state['environment.outside.pressure'] / 100).toFixed(2)),
    wind: {
      speed: ms2kt(state['environment.wind.speedOverGround']),
      direction: rad2deg(state['environment.wind.directionTrue']),
    },
    sea: state['environment.water.swell.state'],
    text,
  };
  return data;
}

module.exports = (app) => {
  const plugin = {};
  let unsubscribes = [];
  let interval;

  plugin.id = 'signalk-logbook';
  plugin.name = 'Logbook';
  plugin.description = 'Semi-automatic electronic logbook for sailing vessels';

  const setStatus = app.setPluginStatus || app.setProviderStatus;

  // The paths we want to listen and collect data for
  const paths = [
    'navigation.state', // Under way/stopped
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

  let log;
  let state = {};

  function processTriggers(path, value, state) {
    // TODO: Implement auto-loggers
  }

  plugin.start = () => {
    log = new Log(app.getDataDirPath());
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
            processTriggers(v.path, v.value, state);
            state[v.path] = v.value;
          });
        });
      },
    );

    interval = setInterval(() => {
      // Save old state to buffer
      if (!state.datetime) {
        state.datetime = new Date().toISOString();
      }
      buffer.enq(state);
      // We can keep a clone of the previous values
      state = {
        ...state,
        datetime: null,
      };
    }, 60000);

    setStatus('Waiting for updates');
  };

  plugin.registerWithRouter = (router) => {
    router.get('/logs', (req, res) => {
      res.contentType('application/json');
      log.listDates()
        .then((dates) => {
          res.send(JSON.stringify(dates));
        }, () => {
          res.sendStatus(500);
        });
    });
    router.post('/logs', (req, res) => {
      res.contentType('application/json');
      let stats = buffer.get(req.body.ago);
      if (!stats) {
        stats = {
          ...state,
        };
      }
      const data = stateToEntry(stats, req.body.text);
      const dateString = new Date(data.datetime).toISOString().substr(0, 10);
      log.appendEntry(dateString, data)
        .then(() => {
          res.sendStatus(201);
        }, () => {
          res.sendStatus(500);
        });
    });
    router.get('/logs/:date', (req, res) => {
      res.contentType('application/json');
      log.getDate(req.params.date)
        .then((date) => {
          res.send(JSON.stringify(date));
        }, () => {
          res.sendStatus(500);
        });
    });
  };

  plugin.stop = () => {
    unsubscribes.forEach((f) => f());
    unsubscribes = [];
    clearInterval(interval);
  };

  plugin.schema = {};

  return plugin;
};
