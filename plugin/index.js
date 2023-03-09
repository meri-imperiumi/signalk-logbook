const CircularBuffer = require('circular-buffer');
const Log = require('./Log');
const stateToEntry = require('./format');
const { processTriggers, processHourly } = require('./triggers');
const openAPI = require('../schema/openapi.json');

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
    'navigation.speedThroughWater',
    'navigation.speedOverGround',
    'navigation.trip.log',
    'navigation.courseRhumbline.nextPoint.position',
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
  ];

  // We keep 15min of past state to allow slight backdating of entries
  const buffer = new CircularBuffer(16);

  let log;
  let state = {};

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
        delta.updates.reduce((prev, u) => prev.then(() => {
          if (!u.values) {
            return Promise.resolve();
          }
          return u.values.reduce((
            previousPromise,
            v,
          ) => previousPromise.then(() => processTriggers(v.path, v.value, state, log, app)
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
      const author = parseJwt(req.cookies.JAUTHENTICATION).id;
      const data = stateToEntry(stats, req.body.text, author);
      if (req.body.category) {
        data.category = req.body.category;
      } else {
        data.category = 'navigation';
      }
      if (req.body.observations) {
        data.observations = {
          ...req.body.observations,
        };
        if (!Number.isNaN(Number(data.observations.seaState))) {
          sendDelta(
            app,
            plugin,
            new Date(data.datetime),
            'environment.water.swell.state',
            data.observations.seaState,
          );
        }
      }
      if (req.body.position) {
        data.position = {
          ...req.body.position,
        };
        // TODO: Send delta on manually entered position?
      }
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
      const author = parseJwt(req.cookies.JAUTHENTICATION).id;
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
        enum: [
          'UTC',
          'Europe/Andorra',
          'Asia/Dubai',
          'Asia/Kabul',
          'Europe/Tirane',
          'Asia/Yerevan',
          'Antarctica/Casey',
          'Antarctica/Davis',
          'Antarctica/DumontDUrville', // https://bugs.chromium.org/p/chromium/issues/detail?id=928068
          'Antarctica/Mawson',
          'Antarctica/Palmer',
          'Antarctica/Rothera',
          'Antarctica/Syowa',
          'Antarctica/Troll',
          'Antarctica/Vostok',
          'America/Argentina/Buenos_Aires',
          'America/Argentina/Cordoba',
          'America/Argentina/Salta',
          'America/Argentina/Jujuy',
          'America/Argentina/Tucuman',
          'America/Argentina/Catamarca',
          'America/Argentina/La_Rioja',
          'America/Argentina/San_Juan',
          'America/Argentina/Mendoza',
          'America/Argentina/San_Luis',
          'America/Argentina/Rio_Gallegos',
          'America/Argentina/Ushuaia',
          'Pacific/Pago_Pago',
          'Europe/Vienna',
          'Australia/Lord_Howe',
          'Antarctica/Macquarie',
          'Australia/Hobart',
          'Australia/Currie',
          'Australia/Melbourne',
          'Australia/Sydney',
          'Australia/Broken_Hill',
          'Australia/Brisbane',
          'Australia/Lindeman',
          'Australia/Adelaide',
          'Australia/Darwin',
          'Australia/Perth',
          'Australia/Eucla',
          'Asia/Baku',
          'America/Barbados',
          'Asia/Dhaka',
          'Europe/Brussels',
          'Europe/Sofia',
          'Atlantic/Bermuda',
          'Asia/Brunei',
          'America/La_Paz',
          'America/Noronha',
          'America/Belem',
          'America/Fortaleza',
          'America/Recife',
          'America/Araguaina',
          'America/Maceio',
          'America/Bahia',
          'America/Sao_Paulo',
          'America/Campo_Grande',
          'America/Cuiaba',
          'America/Santarem',
          'America/Porto_Velho',
          'America/Boa_Vista',
          'America/Manaus',
          'America/Eirunepe',
          'America/Rio_Branco',
          'America/Nassau',
          'Asia/Thimphu',
          'Europe/Minsk',
          'America/Belize',
          'America/St_Johns',
          'America/Halifax',
          'America/Glace_Bay',
          'America/Moncton',
          'America/Goose_Bay',
          'America/Blanc-Sablon',
          'America/Toronto',
          'America/Nipigon',
          'America/Thunder_Bay',
          'America/Iqaluit',
          'America/Pangnirtung',
          'America/Atikokan',
          'America/Winnipeg',
          'America/Rainy_River',
          'America/Resolute',
          'America/Rankin_Inlet',
          'America/Regina',
          'America/Swift_Current',
          'America/Edmonton',
          'America/Cambridge_Bay',
          'America/Yellowknife',
          'America/Inuvik',
          'America/Creston',
          'America/Dawson_Creek',
          'America/Fort_Nelson',
          'America/Vancouver',
          'America/Whitehorse',
          'America/Dawson',
          'Indian/Cocos',
          'Europe/Zurich',
          'Africa/Abidjan',
          'Pacific/Rarotonga',
          'America/Santiago',
          'America/Punta_Arenas',
          'Pacific/Easter',
          'Asia/Shanghai',
          'Asia/Urumqi',
          'America/Bogota',
          'America/Costa_Rica',
          'America/Havana',
          'Atlantic/Cape_Verde',
          'America/Curacao',
          'Indian/Christmas',
          'Asia/Nicosia',
          'Asia/Famagusta',
          'Europe/Prague',
          'Europe/Berlin',
          'Europe/Copenhagen',
          'America/Santo_Domingo',
          'Africa/Algiers',
          'America/Guayaquil',
          'Pacific/Galapagos',
          'Europe/Tallinn',
          'Africa/Cairo',
          'Africa/El_Aaiun',
          'Europe/Madrid',
          'Africa/Ceuta',
          'Atlantic/Canary',
          'Europe/Helsinki',
          'Pacific/Fiji',
          'Atlantic/Stanley',
          'Pacific/Chuuk',
          'Pacific/Pohnpei',
          'Pacific/Kosrae',
          'Atlantic/Faroe',
          'Europe/Paris',
          'Europe/London',
          'Asia/Tbilisi',
          'America/Cayenne',
          'Africa/Accra',
          'Europe/Gibraltar',
          'America/Godthab',
          'America/Danmarkshavn',
          'America/Scoresbysund',
          'America/Thule',
          'Europe/Athens',
          'Atlantic/South_Georgia',
          'America/Guatemala',
          'Pacific/Guam',
          'Africa/Bissau',
          'America/Guyana',
          'Asia/Hong_Kong',
          'America/Tegucigalpa',
          'America/Port-au-Prince',
          'Europe/Budapest',
          'Asia/Jakarta',
          'Asia/Pontianak',
          'Asia/Makassar',
          'Asia/Jayapura',
          'Europe/Dublin',
          'Asia/Jerusalem',
          'Asia/Kolkata',
          'Indian/Chagos',
          'Asia/Baghdad',
          'Asia/Tehran',
          'Atlantic/Reykjavik',
          'Europe/Rome',
          'America/Jamaica',
          'Asia/Amman',
          'Asia/Tokyo',
          'Africa/Nairobi',
          'Asia/Bishkek',
          'Pacific/Tarawa',
          'Pacific/Enderbury',
          'Pacific/Kiritimati',
          'Asia/Pyongyang',
          'Asia/Seoul',
          'Asia/Almaty',
          'Asia/Qyzylorda',
          'Asia/Qostanay', // https://bugs.chromium.org/p/chromium/issues/detail?id=928068
          'Asia/Aqtobe',
          'Asia/Aqtau',
          'Asia/Atyrau',
          'Asia/Oral',
          'Asia/Beirut',
          'Asia/Colombo',
          'Africa/Monrovia',
          'Europe/Vilnius',
          'Europe/Luxembourg',
          'Europe/Riga',
          'Africa/Tripoli',
          'Africa/Casablanca',
          'Europe/Monaco',
          'Europe/Chisinau',
          'Pacific/Majuro',
          'Pacific/Kwajalein',
          'Asia/Yangon',
          'Asia/Ulaanbaatar',
          'Asia/Hovd',
          'Asia/Choibalsan',
          'Asia/Macau',
          'America/Martinique',
          'Europe/Malta',
          'Indian/Mauritius',
          'Indian/Maldives',
          'America/Mexico_City',
          'America/Cancun',
          'America/Merida',
          'America/Monterrey',
          'America/Matamoros',
          'America/Mazatlan',
          'America/Chihuahua',
          'America/Ojinaga',
          'America/Hermosillo',
          'America/Tijuana',
          'America/Bahia_Banderas',
          'Asia/Kuala_Lumpur',
          'Asia/Kuching',
          'Africa/Maputo',
          'Africa/Windhoek',
          'Pacific/Noumea',
          'Pacific/Norfolk',
          'Africa/Lagos',
          'America/Managua',
          'Europe/Amsterdam',
          'Europe/Oslo',
          'Asia/Kathmandu',
          'Pacific/Nauru',
          'Pacific/Niue',
          'Pacific/Auckland',
          'Pacific/Chatham',
          'America/Panama',
          'America/Lima',
          'Pacific/Tahiti',
          'Pacific/Marquesas',
          'Pacific/Gambier',
          'Pacific/Port_Moresby',
          'Pacific/Bougainville',
          'Asia/Manila',
          'Asia/Karachi',
          'Europe/Warsaw',
          'America/Miquelon',
          'Pacific/Pitcairn',
          'America/Puerto_Rico',
          'Asia/Gaza',
          'Asia/Hebron',
          'Europe/Lisbon',
          'Atlantic/Madeira',
          'Atlantic/Azores',
          'Pacific/Palau',
          'America/Asuncion',
          'Asia/Qatar',
          'Indian/Reunion',
          'Europe/Bucharest',
          'Europe/Belgrade',
          'Europe/Kaliningrad',
          'Europe/Moscow',
          'Europe/Simferopol',
          'Europe/Kirov',
          'Europe/Astrakhan',
          'Europe/Volgograd',
          'Europe/Saratov',
          'Europe/Ulyanovsk',
          'Europe/Samara',
          'Asia/Yekaterinburg',
          'Asia/Omsk',
          'Asia/Novosibirsk',
          'Asia/Barnaul',
          'Asia/Tomsk',
          'Asia/Novokuznetsk',
          'Asia/Krasnoyarsk',
          'Asia/Irkutsk',
          'Asia/Chita',
          'Asia/Yakutsk',
          'Asia/Khandyga',
          'Asia/Vladivostok',
          'Asia/Ust-Nera',
          'Asia/Magadan',
          'Asia/Sakhalin',
          'Asia/Srednekolymsk',
          'Asia/Kamchatka',
          'Asia/Anadyr',
          'Asia/Riyadh',
          'Pacific/Guadalcanal',
          'Indian/Mahe',
          'Africa/Khartoum',
          'Europe/Stockholm',
          'Asia/Singapore',
          'America/Paramaribo',
          'Africa/Juba',
          'Africa/Sao_Tome',
          'America/El_Salvador',
          'Asia/Damascus',
          'America/Grand_Turk',
          'Africa/Ndjamena',
          'Indian/Kerguelen',
          'Asia/Bangkok',
          'Asia/Dushanbe',
          'Pacific/Fakaofo',
          'Asia/Dili',
          'Asia/Ashgabat',
          'Africa/Tunis',
          'Pacific/Tongatapu',
          'Europe/Istanbul',
          'America/Port_of_Spain',
          'Pacific/Funafuti',
          'Asia/Taipei',
          'Europe/Kiev',
          'Europe/Uzhgorod',
          'Europe/Zaporozhye',
          'Pacific/Wake',
          'America/New_York',
          'America/Detroit',
          'America/Kentucky/Louisville',
          'America/Kentucky/Monticello',
          'America/Indiana/Indianapolis',
          'America/Indiana/Vincennes',
          'America/Indiana/Winamac',
          'America/Indiana/Marengo',
          'America/Indiana/Petersburg',
          'America/Indiana/Vevay',
          'America/Chicago',
          'America/Indiana/Tell_City',
          'America/Indiana/Knox',
          'America/Menominee',
          'America/North_Dakota/Center',
          'America/North_Dakota/New_Salem',
          'America/North_Dakota/Beulah',
          'America/Denver',
          'America/Boise',
          'America/Phoenix',
          'America/Los_Angeles',
          'America/Anchorage',
          'America/Juneau',
          'America/Sitka',
          'America/Metlakatla',
          'America/Yakutat',
          'America/Nome',
          'America/Adak',
          'Pacific/Honolulu',
          'America/Montevideo',
          'Asia/Samarkand',
          'Asia/Tashkent',
          'America/Caracas',
          'Asia/Ho_Chi_Minh',
          'Pacific/Efate',
          'Pacific/Wallis',
          'Pacific/Apia',
          'Africa/Johannesburg'
        ],
      },
    },
  };

  plugin.getOpenApi = () => openAPI;

  return plugin;
};
