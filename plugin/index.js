const CircularBuffer = require('circular-buffer');
const Log = require('./Log');

function stateToEntry(state, text) {
  const data = {
    datetime: new Date(state['navigation.datetime']) || new Date(),
    position: {
      ...state['navigation.position'],
      source: state['navigation.gnss.type'] || 'GPS',
    },
    heading: state['navigation.headingTrue'],
    speed: {
      stw: state['navigation.speedThroughWater'],
      sog: state['navigation.speedOverGround'],
    },
    log: state['navigation.trip.log'],
    waypoint: state['navigation.courseRhumbline.nextPoint.position'],
    barometer: state['environment.outside.pressure'],
    wind: {
      speed: state['environment.wind.speedOverGround'],
      direction: state['environment.wind.directionTrue'],
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

  plugin.registerWithRouter = (router) => {
    router.get('/logs', (req, res) => {
      res.contentType('application/json');
      log.listEntries()
        .then((entries) => {
          res.send(JSON.stringify(entries));
        }, () => {
          res.sendStatus(500);
        });
    });
    router.post('/logs', (req, res) => {
      res.contentType('application/json');
      const dateString = new Date().toISOString().substr(0, 10);
      let stats = buffer.get(req.body.ago);
      if (!stats) {
        stats = {
          ...state,
        };
      }
      const data = stateToEntry(stats, req.body.text);
      log.appendEntry(dateString, data)
        .then(() => {
          res.sendStatus(201);
        }, (e) => {
          console.log(e);
          res.sendStatus(500);
        });
    });
    router.get('/logs/:date', (req, res) => {
      res.contentType('application/json');
      log.getEntry(req.params.date)
        .then((entry) => {
          res.send(JSON.stringify(entry));
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
