const CircularBuffer = require('circular-buffer');
const timezones = require('timezones-list');
const Log = require('./Log');
const stateToEntry = require('./format');
const applyBodyFields = require('./entryFields');
const resolveAgo = require('./ago');
const { processTriggers, processHourly } = require('./triggers');
const { processNotification, sweepNotifications, buildConfig } = require('./notifications');
const openAPI = require('../schema/openapi.json');

const timezonesList = [
  {
    tzCode: 'UTC',
    label: 'UTC',
  },
  ...timezones.default,
];

function parseJwt(token) {
  if (!token) {
    return {};
  }
  return JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
}

function sendDelta(app, plugin, time, path, value) {
  app.handleMessage(plugin.id, {
    context: `vessels.${app.selfId}`,
    updates: [
      {
        source: {
          label: plugin.id,
        },
        timestamp: time.toISOString(),
        values: [
          {
            path,
            value,
          },
        ],
      },
    ],
  });
}
function sendCrewNames(app, plugin) {
  const { configuration } = app.readPluginOptions();
  if (!configuration) {
    return;
  }
  sendDelta(app, plugin, new Date(), 'communication.crewNames', configuration.crewNames || []);
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
    'navigation.courseOverGroundTrue',
    'navigation.speedThroughWater',
    'navigation.speedOverGround',
    'navigation.log',
    'navigation.course.nextPoint',
    'environment.outside.pressure',
    'environment.wind.directionTrue',
    'environment.wind.speedOverGround',
    'environment.water.swell.state',
    'propulsion.*.state',
    'propulsion.*.runTime',
    'sails.inventory.*',
    'steering.autopilot.state',
    'communication.crewNames',
    'communication.vhf.channel',
    'notifications.*',
    'watch.current',
  ];

  // We keep 15min of past state to allow slight backdating of entries
  const buffer = new CircularBuffer(16);

  let log;
  let state = {};
  const episodes = new Map();
  let notificationConfig = buildConfig({});

  plugin.start = () => {
    log = new Log(app.getDataDirPath());
    const options = app.readPluginOptions();
    notificationConfig = buildConfig((options && options.configuration) || {});
    episodes.clear();
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
        delta.updates.reduce((prev, u) => prev.then(() => {
          if (!u.values) {
            return Promise.resolve();
          }
          return u.values.reduce((
            previousPromise,
            v,
          ) => previousPromise.then(() => (
            v.path.startsWith('notifications.')
              ? processNotification(
                v.path,
                v.value,
                state,
                episodes,
                log,
                app,
                notificationConfig,
                Date.now(),
              )
              : processTriggers(v.path, v.value, state, log, app)
          )
            .then((stateUpdates) => {
              if (!stateUpdates) {
                return;
              }
              // Trigger wants to write state
              Object.keys(stateUpdates).forEach((key) => {
                state[key] = stateUpdates[key];
              });
            }, (err) => {
              app.setPluginError(`Failed to store entry: ${err.message}`);
            })
            .then(() => {
              if (u.$source === 'signalk-logbook.XX' && v.path !== 'communication.crewNames') {
                // Don't store our reports into state
                return;
              }
              // Copy new value into state
              state[v.path] = v.value;
            })), Promise.resolve());
        }), Promise.resolve());
      },
    );

    interval = setInterval(() => {
      // Save old state to buffer
      if (!state.datetime) {
        state.datetime = new Date().toISOString();
      }
      if (new Date(state.datetime).getMinutes() === 0) {
        // Store hourly log entry
        processHourly(state, log, app)
          .catch((err) => {
            app.setPluginError(`Failed to store entry: ${err.message}`);
          });
        sendCrewNames(app, plugin);
      }
      buffer.enq(state);
      sweepNotifications(episodes, state, log, app, notificationConfig, Date.now())
        .catch((err) => {
          app.setPluginError(`Failed to store notification entry: ${err.message}`);
        });
      // We can keep a clone of the previous values
      state = {
        ...state,
        datetime: null,
      };
    }, 60000);

    app.registerPutHandler('vessels.self', 'communication.crewNames', (ctx, path, value, cb) => {
      if (!Array.isArray(value)) {
        return {
          state: 'COMPLETED',
          statusCode: 400,
          message: 'crewNames must be an array',
        };
      }
      const faulty = value.findIndex((v) => typeof v !== 'string');
      if (faulty !== -1) {
        return {
          state: 'COMPLETED',
          statusCode: 400,
          message: 'Each crewName must be a string',
        };
      }
      let { configuration } = app.readPluginOptions();
      if (!configuration) {
        configuration = {};
      }
      configuration.crewNames = value;
      app.savePluginOptions(configuration, (err) => {
        if (err) {
          cb({
            state: 'COMPLETED',
            statusCode: 500,
            message: err.message,
          });
          return;
        }
        sendCrewNames(app, plugin);
        cb({
          state: 'COMPLETED',
          statusCode: 200,
        });
      });
      return {
        state: 'PENDING',
      };
    });
    sendCrewNames(app, plugin);

    setStatus('Waiting for updates');
  };

  plugin.registerWithRouter = (router) => {
    function handleError(error, res) {
      if (error.code === 'ENOENT') {
        res.sendStatus(404);
        return;
      }
      if (error.stack && error.message) {
        app.debug(error.stack);
        res.status(400);
        res.send({
          message: error.stack,
        });
        return;
      }
      app.debug(error.message);
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
      // Default to 0 (most recent sample) when `ago` is missing/invalid —
      // otherwise buffer.get(undefined) throws and 500s the request.
      const ago = resolveAgo(req.body.ago);
      if (ago > buffer.size()) {
        // We don't have history that far, sadly
        res.sendStatus(404);
        return;
      }
      if (buffer.size() > 0) {
        stats = buffer.get(ago);
      } else {
        stats = {
          ...state,
        };
      }
      let author = '';
      if (req.cookies && req.cookies.JAUTHENTICATION) {
        author = parseJwt(req.cookies.JAUTHENTICATION).id;
      }
      const data = applyBodyFields(stateToEntry(stats, req.body.text, author), req.body);
      if (req.body.observations && !Number.isNaN(Number(req.body.observations.seaState))) {
        sendDelta(
          app,
          plugin,
          new Date(data.datetime),
          'environment.water.swell.state',
          data.observations.seaState,
        );
      }
      // TODO: Send delta on manually entered position?
      const dateString = new Date(data.datetime).toISOString().substr(0, 10);
      log.appendEntry(dateString, data)
        .then(() => {
          setStatus(`Manual log entry: ${req.body.text}`);
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
      const entry = {
        ...req.body,
      };
      let author = '';
      if (req.cookies && req.cookies.JAUTHENTICATION) {
        author = parseJwt(req.cookies.JAUTHENTICATION).id;
      }
      if (author && !entry.author) {
        entry.author = author;
      }
      log.writeEntry(entry)
        .then(() => {
          res.sendStatus(200);
        }, (e) => handleError(e, res));
    });
    router.delete('/logs/:date/:entry', (req, res) => {
      if (req.params.entry.substr(0, 10) !== req.params.date) {
        res.sendStatus(404);
        return;
      }
      log.deleteEntry(req.params.entry)
        .then(() => {
          res.sendStatus(204);
        }, (e) => handleError(e, res));
    });
  };

  plugin.stop = () => {
    unsubscribes.forEach((f) => f());
    unsubscribes = [];
    clearInterval(interval);
    episodes.clear();
  };

  plugin.schema = {
    type: 'object',
    properties: {
      crewNames: {
        type: 'array',
        default: [],
        title: 'Crew list',
        items: {
          type: 'string',
        },
      },
      displayTimeZone: {
        type: 'string',
        default: 'UTC',
        title: 'Select the display time zone',
        oneOf: timezonesList.map((tz) => ({
          const: tz.tzCode,
          title: tz.label,
        })),
      },
      logNotifications: {
        type: 'boolean',
        default: true,
        title: 'Automatically log notifications (alarms and warnings)',
      },
      notificationMinLevel: {
        type: 'string',
        default: 'warn',
        title: 'Minimum notification level to log',
        oneOf: [
          { const: 'alert', title: 'Alert' },
          { const: 'warn', title: 'Warning' },
          { const: 'alarm', title: 'Alarm' },
          { const: 'emergency', title: 'Emergency' },
        ],
      },
      notificationDebounceMinutes: {
        type: 'number',
        default: 5,
        title: 'Minutes a notification must stay clear before it is logged as resolved',
      },
      notificationExcludePaths: {
        type: 'array',
        default: [],
        title: 'Notification paths to ignore (prefix match, e.g. navigation.gnss)',
        items: {
          type: 'string',
        },
      },
      logNotificationClears: {
        type: 'boolean',
        default: true,
        title: 'Also log when a notification clears',
      },
    },
  };

  plugin.getOpenApi = () => openAPI;

  return plugin;
};
