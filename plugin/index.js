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
    datetime: state['navigation.datetime'] || new Date().toISOString(),
    waypoint: state['navigation.courseRhumbline.nextPoint.position'],
    text,
  };
  if (state['navigation.position']) {
    data.position = {
      ...state['navigation.position'],
    };
  }
  if (state['navigation.gnss.type'] && data.position) {
    data.position.source = state['navigation.gnss.type'];
  }
  if (!Number.isNaN(Number(state['navigation.headingTrue']))) {
    data.heading = rad2deg(state['navigation.headingTrue']);
  }
  if (!Number.isNaN(Number(state['navigation.speedThroughWater']))) {
    if (!data.speed) {
      data.speed = {};
    }
    data.speed.stw = ms2kt(state['navigation.speedThroughWater']);
  }
  if (!Number.isNaN(Number(state['navigation.speedOverGround']))) {
    if (!data.speed) {
      data.speed = {};
    }
    data.speed.sog = ms2kt(state['navigation.speedOverGround']);
  }
  if (!Number.isNaN(Number(state['navigation.trip.log']))) {
    data.log = parseFloat((state['navigation.trip.log'] / 1852).toFixed(1));
  }
  if (!Number.isNaN(Number(state['environment.outside.pressure']))) {
    data.barometer = parseFloat((state['environment.outside.pressure'] / 100).toFixed(2));
  }
  if (!Number.isNaN(Number(state['environment.wind.speedOverGround']))) {
    if (!data.wind) {
      data.wind = {};
    }
    data.wind.speed = ms2kt(state['environment.wind.speedOverGround']);
  }
  if (!Number.isNaN(Number(state['environment.wind.directionTrue']))) {
    if (!data.wind) {
      data.wind = {};
    }
    data.wind.direction = rad2deg(state['environment.wind.directionTrue']);
  }
  if (!Number.isNaN(Number(state['environment.water.swell.state']))) {
    data.sea = state['environment.water.swell.state'];
  }
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

  function processTriggers(path, value, oldState) {
    // TODO: Implement auto-loggers
  }

  plugin.start = () => {
    log = new Log(app.getDataDirPath());
    const subscription = {
      context: 'vessels.self',
      subscribe: paths.map((p) => ({
        path: p,
        period: 1000,
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
    function handleError(error, res) {
      if (error.code === 'ENOENT') {
        res.sendStatus(404);
        return;
      }
      if (error.stack && error.message) {
        res.status(400);
        res.send({
          message: res.stack,
        });
        return;
      }
      res.sendStatus(500);
    }
    router.get('/logs', (req, res) => {
      res.contentType('application/json');
      log.listDates()
        .then((dates) => {
          res.send(JSON.stringify(dates));
        }, (e) => handleError(e, res));
    });
    router.post('/logs', (req, res) => {
      res.contentType('application/json');
      let stats;
      if (req.body.ago > buffer.size()) {
        // We don't have history that far, sadly
        res.sendStatus(404);
        return;
      }
      if (buffer.size() > 0) {
        stats = buffer.get(req.body.ago);
      } else {
        stats = {
          ...state,
        };
      }
      const data = stateToEntry(stats, req.body.text);
      const dateString = new Date(data.datetime).toISOString().substr(0, 10);
      log.appendEntry(dateString, data)
        .then(() => {
          res.sendStatus(201);
        }, (e) => handleError(e, res));
    });
    router.get('/logs/:date', (req, res) => {
      res.contentType('application/json');
      log.getDate(req.params.date)
        .then((date) => {
          res.send(JSON.stringify(date));
        }, (e) => handleError(e, res));
    });
    router.get('/logs/:date/:entry', (req, res) => {
      res.contentType('application/json');
      if (req.params.entry.substr(0, 10) !== req.params.date) {
        res.sendStatus(404);
        return;
      }
      log.getEntry(req.params.entry)
        .then((entry) => {
          res.send(JSON.stringify(entry));
        }, (e) => handleError(e, res));
    });
    router.put('/logs/:date/:entry', (req, res) => {
      res.contentType('application/json');
      if (req.params.entry.substr(0, 10) !== req.params.date) {
        res.sendStatus(404);
        return;
      }
      log.writeEntry(req.body)
        .then(() => {
          res.sendStatus(200);
        }, (e) => handleError(e, res));
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
