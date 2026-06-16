* 0.8.1 (2026-06-12)
  - Added safety for missing sail type in sail plan editor
  - Added icon that works better in the SK webapps screen
* 0.8.0 (2026-06-12)
  - Added support for displaying engine hours for multiple engines, when available
  - In logbook view days are now shown with a separator
  - Get next waypoint position from `navigation.course.nextPoint` to support both rhumb line and great circle routes
  - Added safety against clearing logfile on validation failures
  - Added timezone to the metadata view
* 0.7.2 (2024-05-13)
  - Fix issue storing entries when `navigation.position` includes altitude
* 0.7.1 (2024-04-23)
  - Allow storing log entries when VHF channel is a single digit one
* 0.7.0 (2023-04-27)
  - Time range filter for logs to show is now editable (and persisted)
* 0.6.1 (2023-04-05)
  - Motor start/stop is not logged separately when under way as it will change vessel state and produce a log that way
* 0.6.0 (2023-04-05)
  - Course over ground is now also stored in the log data. It is shown instead of heading when available
  - Logbook view was made more compact by combining wind and weather observation columns
  - Compatibility with older Node.js versions, like the one on Venus OS
  - The "log" data now uses `navigation.log` instead of `navigation.trip.log`
* 0.5.0 (2023-03-13)
  - Timezone used when displaying entries is now configurable in plugin settings. Still defaults to UTC.
  - Observations form is shown only for navigation entries to reduce clutter
* 0.4.2 (2023-03-08)
  - Fixed issue when there is no recorded speed in a log entry
* 0.4.1 (2023-03-06)
  - Fixed issue when plugin has no configuration
  - Enabled _Edit_ button for sails editor when no sails are set as active
* 0.4.0 (2023-03-05)
  - User interface and logging for sail changes, powered by the [sailsconfiguration](https://github.com/SignalK/sailsconfiguration) plugin
  - User interface and logging for crew changes
  - User interface for recording weather observations (sea state, cloud coverage, visibility)
  - User interface for recording manual fixes when using celestial navigation etc
  - Fix for logbook view when there is no wind data available
* 0.3.0 (2023-02-22)
  - Map view now fetches vessel track using the Signal K History API, if available
  - Fixed engine name capture for automatic logs
  - Added OpenAPI for easier Logbook API discoverability and usage
* 0.2.1 (2023-02-15)
  - Added triggers for automatically logging when engine is started or stopped
  - Added VHF channel to radio logs. Automatically populated when available (see for example [the Icom M510e plugin](https://www.npmjs.com/package/signalk-icom-m510e-plugin))
* 0.2.0 (2023-02-15)
  - Added support for multiple entry categories (navigation, engine, etc)
  - Automatic entry creation when changing autopilot state
  - Added an `end` flag to entries marking end of a trip
  - Added engine hours to logs
* 0.1.2 (2023-02-08)
  - Implemented entry deletion
  - Fixed issue with initial load if logging in within this webapp (#5)
* 0.1.0 (2023-02-03)
  - Initial release

