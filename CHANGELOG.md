# Changelog
## [Unreleased]
### Added
- You can now choose the chart provider to use with the map feature

### Fixed
- "N minutes ago" now shows the selected value

## [0.9.6] - 2026-07-07
### Fixed
- Logbook no longer fails on empty files
- Automatic entries for watch changes now record names correctly

## [0.9.5] - 2026-07-02
### Changed
- Hourly automatic entries now check if there is an entry already (produced by user or by another automation) before writing one
- Currently on-watch crew member is shown underlined

## [0.9.4] - 2026-06-29
### Added
- When a [watch schedule is active](https://github.com/hoeken/signalk-watch-schedule), watch changes get logged automatically

### Fixed
- Map loads correctly also on southerly latitudes

## [0.9.3] - 2026-06-19
### Fixed
- The `ago` key defaults to 0 instead of failing on HTTP POST requests

## [0.9.2] - 2026-06-16
### Changed
- `vhf` can now be submitted in POST requests
- App icon is now smaller

## [0.9.1] - 2026-06-16
### Changed
- Better app icon

## [0.9.0] - 2026-06-16
### Added
- Notifications and alerts are now logged
- Added automatic Signal K plugin testing

## [0.8.1] - 2026-06-12
### Added
- Added safety for missing sail type in sail plan editor
- Added icon that works better in the SK webapps screen

## [0.8.0] - 2026-06-12
### Added
- Added support for displaying engine hours for multiple engines, when available
- Added safety against clearing logfile on validation failures
- Added timezone to the metadata view

### Changed
- In logbook view days are now shown with a separator
- Get next waypoint position from `navigation.course.nextPoint` to support both rhumb line and great circle routes

## [0.7.2] - 2024-05-13
### Fixed
- Fix issue storing entries when `navigation.position` includes altitude

## [0.7.1] - 2024-04-23
### Changed
- Allow storing log entries when VHF channel is a single digit one

## [0.7.0] - 2023-04-27
### Changed
- Time range filter for logs to show is now editable (and persisted)

## [0.6.1] - 2023-04-05
### Changed
- Motor start/stop is not logged separately when under way as it will change vessel state and produce a log that way

## [0.6.0] - 2023-04-05
### Changed
- Course over ground is now also stored in the log data. It is shown instead of heading when available
- Logbook view was made more compact by combining wind and weather observation columns
- Compatibility with older Node.js versions, like the one on Venus OS
- The "log" data now uses `navigation.log` instead of `navigation.trip.log`

## [0.5.0] - 2023-03-13
### Changed
- Timezone used when displaying entries is now configurable in plugin settings. Still defaults to UTC.
- Observations form is shown only for navigation entries to reduce clutter

## [0.4.2] - 2023-03-08
### Fixed
- Fixed issue when there is no recorded speed in a log entry

## [0.4.1] - 2023-03-06
### Changed
- Enabled _Edit_ button for sails editor when no sails are set as active

### Fixed
- Fixed issue when plugin has no configuration

## [0.4.0] - 2023-03-05
### Changed
- User interface and logging for sail changes, powered by the [sailsconfiguration](https://github.com/SignalK/sailsconfiguration) plugin
- User interface and logging for crew changes
- User interface for recording weather observations (sea state, cloud coverage, visibility)
- User interface for recording manual fixes when using celestial navigation etc

### Fixed
- Fix for logbook view when there is no wind data available

## [0.3.0] - 2023-02-22
### Added
- Added OpenAPI for easier Logbook API discoverability and usage

### Changed
- Map view now fetches vessel track using the Signal K History API, if available

### Fixed
- Fixed engine name capture for automatic logs

## [0.2.1] - 2023-02-15
### Added
- Added triggers for automatically logging when engine is started or stopped
- Added VHF channel to radio logs. Automatically populated when available (see for example [the Icom M510e plugin](https://www.npmjs.com/package/signalk-icom-m510e-plugin))

## [0.2.0] - 2023-02-15
### Added
- Added support for multiple entry categories (navigation, engine, etc)
- Added an `end` flag to entries marking end of a trip
- Added engine hours to logs

### Changed
- Automatic entry creation when changing autopilot state

## [0.1.2] - 2023-02-08
### Added
- Implemented entry deletion

### Fixed
- Fixed issue with initial load if logging in within this webapp (#5)

## [0.1.0] - 2023-02-03
### Changed
- Initial release

