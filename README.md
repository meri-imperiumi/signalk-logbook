Semi-automatic logbook for Signal K
===================================

Status: in production on multiple vessels

This application provides both a server-side plugin and the user interface for maintaining semi-automatic logbooks with [Signal K](https://signalk.org). Just like traditional logbooks, you can write an entry at any time. However, there are several things that are done automatically for you:

* Entries written when starting/ending a trip (requires [signalk-autostate](https://github.com/meri-imperiumi/signalk-autostate) plugin)
* When underway, an entry is created every hour recording the current conditions
* Engine stop/start is logged automatically (if available in Signal K. See [signalk-alternator-engine-on](https://github.com/meri-imperiumi/signalk-alternator-engine-on))
* Signal K alerts when they're raised and cleared
* Watch changes are logged automatically (requires [signalk-watch-schedule](https://github.com/hoeken/signalk-watch-schedule) plugin)

## User interface

The logbook presents a web-based user interface as part of the [Signal K](https://signalk.org) administration interface. The features should work fine on both desktop and mobile browsers.

Adding a log entry:
![Add entry](https://i.imgur.com/0M7CdOY.png)

Traditional logbook view:
![Logbook as table](https://i.imgur.com/Xa6XNyh.png)
![Editing an entry](https://i.imgur.com/CDD57LQ.png)

Log entries on a map:
![Map view](https://user-images.githubusercontent.com/3346/219135937-0e1b75cf-13ed-4f79-9ba0-0d2b6fee7747.jpeg)

The map uses whatever chart layers you've configured in Signal K (via
[resources providers](https://github.com/SignalK/charts-plugin) such as the charts plugin) — offline
MBTiles, ENCs, or a tile proxy — with a layer switcher when more than one is available. If no charts
are configured it falls back to OpenStreetMap tiles. Note that OSM's [tile usage
policy](https://operations.osmfoundation.org/policies/tiles/) blocks referer-less requests, which
self-hosted Signal K setups often trigger, so installing the charts plugin (or another
`resources/charts` provider) is the reliable way to get a working map.

Registering sail changes:
![Sails editor](https://user-images.githubusercontent.com/3346/222392061-6760eb71-93a8-4c99-b47b-a9f2fd7b1c54.png)

## Data storage and format

This logbook app writes the logs to disk using [YAML format](https://en.wikipedia.org/wiki/YAML) which combines machine readability with at least some degree of human readability.

Logs are stored on a file per day basis at `~/.signalk/plugin-config-data/signalk-logbook/YYYY-MM-DD.yml` 
If there are no entries for a given day, no file gets written.

Note: unlike Signal K itself, the log entries are written using "human-friendly" units, so degrees, knots, etc. They look something like:

```yaml
- id: 1b4e28ba-2fa1-11d2-883f-b9a761bde3fb
  datetime: 2014-08-15T19:00:19.546Z
  position:
    longitude: 24.7363006
    latitude: 59.7243978
    source: GPS
  heading: 202
  course: 198
  speed:
    stw: 12.5
    sog: 11.8
  log: 9.6
  waypoint: null
  barometer: 1008.71
  wind:
    speed: 13.7
    direction: 283
  engine:
    hours: 405
  category: navigation
  origin: manual
  text: Set 1st reef on mainsail
  author: bergie
```

Every entry carries a stable UUID `id` (assigned by the plugin, also on entries written through the v1 API or the automatic triggers) and an `origin` field saying how the line came to be (`manual`, `auto`, or `agent`). Entries that carry data with no historical field — unknown Signal K paths, or pathvalues with source metadata — park those verbatim in a `telemetry` array.

These YAML files are the plugin's storage and backup format (restores, migration between installs of this plugin). The interchange format — the one to export, import, and build third-party apps against — is the [logentries resources API](#logentries-resources-api) representation: Signal K paths, SI units, and an open content model.

It is a good idea to set up automatic backups of these files off the vessel, for example to [GitHub](https://github.com) or some other cloud storage service. How to handle this backup is out of the scope of this plugin.

For making a hard copy of the logbook, the [logbook-printer](https://github.com/meri-imperiumi/logbook-printer) repository implements a service to do so with a cheap receipt printer.

## Source data

The following SignalK paths are used by this logbook.

|SingleK path|Timeline name|YAML path|Notes|
|-|-|-|-|
|`navigation.datetime`|Time|`/datetime`|Falls back to system time if not present. Display timezone can be configured.|
|`navigation.courseOverGroundTrue`|Course|`/course`||
|`navigation.headingTrue`|Heading|`/heading`||
|`navigation.speedThroughWater`||`/speed/stw`||
|`navigation.speedOverGround`|Speed|`/speed/sog`||
|`environment.wind.directionTrue`|Wind|`/wind/direction`||
|`environment.wind.speedOverGround`|Wind|`/wind/speed`||
|`environment.outside.pressure`|Baro|`/barometer`||
|`environment.water.swell.state`|Sea|`/observations/seaState`||
|`navigation.position`|Coordinates|`/position/longitude` `/position/latitude`||
|`navigation.gnss.type`|Fix|`/position/source`|Defaults to "GPS".|
|`navigation.log`|Log|`/log`||
|`propulsion.*.runTime`|Engine|`/engine/hours`||
|`sails.inventory.*`|||Sail changes are logged.|
|`communication.crewNames`||`/crewNames`|Crew changes are logged.|
|`communication.skipperName`||`/skipperName`|Snapshotted into every entry. Skipper changes are logged.|
|`steering.autopilot.state`|||Autopilot changes are logged.|
|`navigation.state`|||If present, used to start and stop automated hourly entries. Changes are logged.|
|`propulsion.*.state`|||Propulsion changes are logged.|
|`communication.vhf.channel`||`/vhf`||
|`navigation.course.nextPoint.position`||`/waypoint`||
|`notifications.*`||`/category`|Alarms and warnings are logged automatically. See below.|
|`watch.current`|||Watch changes are logged.|

The [signalk-derived-data](https://github.com/sbender9/signalk-derived-data) and [signalk-path-mapper](https://github.com/sbender9/signalk-path-mapper) plugins are both useful to remap available data to the required canonical paths.

## Automatic notification logging

The plugin records SignalK notifications (alarms and warnings) automatically. When a
notification rises to the configured minimum level (`warn` by default) a log entry is
written, and another is written when it clears.

To avoid log spam from a sensor that cycles across its threshold (a bilge or low-tank
alarm, for example), repeated raises and brief clears are coalesced into a single
*episode*: one "raised" entry when it first fires, and one "cleared" entry only after it
has stayed clear for the debounce window — the clear entry notes how long it lasted, the
peak level reached, and how many times it toggled.

Configuration (plugin settings):

* **Automatically log notifications** — master on/off (default on).
* **Minimum notification level to log** — `alert`, `warn` (default), `alarm`, or `emergency`.
* **Minutes a notification must stay clear before it is logged as resolved** — debounce window (default 5).
* **Notification paths to ignore** — prefix matches to suppress known-noisy paths (e.g. `navigation.gnss`).
* **Also log when a notification clears** — turn off for raise-only logging (default on).

## API

### Logentries resources API

Logbook entries are exposed as a [Signal K v2 Resources API](https://github.com/SignalK/signalk-server/blob/master/packages/server-api/src/resourcesapi.ts) resource type, `logentries`, with this plugin acting as the reference Resource Provider. Any other plugin can append, read, edit and delete entries through `app.resourcesApi`, and REST or websocket clients through the standard resources routes — no admin tokens needed, `readonly` tokens can read and `readwrite` tokens can write:

```
GET    /signalk/v2/api/resources/logentries?from=...&to=...
GET    /signalk/v2/api/resources/logentries?dates=true
GET    /signalk/v2/api/resources/logentries/<uuid>
POST   /signalk/v2/api/resources/logentries
PUT    /signalk/v2/api/resources/logentries/<uuid>
DELETE /signalk/v2/api/resources/logentries/<uuid>
```

Listings must carry a window — `date`, `from`/`to`, or `limit` — plus optional `bbox`, `category`, `origin` and `author` filters; `dates=true` returns a day-calendar summary. Entries are identified by stable UUIDs, carry a telemetry snapshot as Signal K paths in SI units, and support the same-millisecond multiple-values model of Signal K deltas. Writing an entry from another plugin:

```js
await app.resourcesApi.setResource('logentries', crypto.randomUUID(), {
  text: 'Genoa furled',
  origin: 'agent',
  category: 'navigation',
});
```

The machine-readable entry schema is published at [schema/logentries.schema.json](schema/logentries.schema.json) and the full contract — identity rules, telemetry paths, enrichment semantics, permissions — is specified in [docs/logentries-resource.md](docs/logentries-resource.md). Backdated entries are enriched from the vessel's live state buffer (last 15 minutes) or the [History API](https://github.com/SignalK/signalk-history-sqlite) when one is installed, so a line written hours later still gets its position, speeds and weather filled in; send `"enrich": false` to skip lookups when bulk importing data that is already complete.

### Deprecated v1 logbook API

The plugin's private REST routes under `/plugins/signalk-logbook/logs` are deprecated in favor of the resources API above (see the [v1 OpenAPI document](https://editor.swagger.io/?url=https://raw.githubusercontent.com/meri-imperiumi/signalk-logbook/main/schema/openapi.yaml)). They keep working — v1 responses carry `Deprecation` headers and each call is noted in the server debug log — but new capabilities (filtering, the open schema, `readonly`-token access, multi-engine telemetry keys) exist only on the resources API. No removal is currently scheduled.

## Ideas

Some additional ideas for the future:

* Enable creating additional rules for automated entries when certain things happen (for example, when turning on a watermaker).
* We could ship easy systemd unit files for setting up backups to popular locations, like pushing to a git repo
* One-time script for populating logbook from InfluxDB entries when starting to use the system

## Changes

See [Changelog](CHANGELOG.md)
