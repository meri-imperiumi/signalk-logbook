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
- datetime: 2014-08-15T19:00:19.546Z
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
  text: Set 1st reef on mainsail
  author: bergie
```

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

Other applications can also use the [logbook API](https://editor.swagger.io/?url=https://raw.githubusercontent.com/meri-imperiumi/signalk-logbook/main/schema/openapi.yaml) for retrieving and writing log entries. This can be useful for automations with [Node-Red](https://nodered.org) or [NoFlo](https://noflojs.org) etc.

## Ideas

Some additional ideas for the future:

* Enable creating additional rules for automated entries when certain things happen (for example, when turning on a watermaker).
* We could ship easy systemd unit files for setting up backups to popular locations, like pushing to a git repo
* One-time script for populating logbook from InfluxDB entries when starting to use the system

## Changes

See [Changelog](CHANGELOG.md)
