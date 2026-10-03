# Changelog
## [Unreleased]
### Added
- Logbook entries are now also available through the Signal K v2 **Resources API** as a custom resource type `logentries`, with the plugin acting as the reference Resource Provider: other plugins can append, read, edit and delete entries via `app.resourcesApi` and REST clients via `/signalk/v2/api/resources/logentries`, without touching the plugin's private routes or files. Resource ids are UUIDs; `setResource` is a create-or-replace upsert where an omitted `datetime` defaults to now on create and is preserved on replace. Entries are represented per the new contract in `docs/logentries-resource.md` — Signal K paths and SI units in a `telemetry` array of delta pathvalues (multiple values per path supported), the logbook's own fields at the top level — translated at the provider boundary to the storage's historical nautical field names and units, which are unchanged. Sea state is carried as Beaufort on the API's `environment.water.seaState` path (the Weather API's scale), mapping through the standard WMO correspondence to storage's Douglas code
- Listings on the new API require a window — `date`, `from`/`to`, or `limit` — so every response is complete by construction, plus `bbox`, `category`, `origin` and `author` filters and a `dates=true` day-calendar summary. `limit` selects the newest N matches and presents them ascending
- Tiered enrichment on the new API fills telemetry paths the write omits: entries dated within the last 15 minutes are filled from the live state buffer, older backdated entries from the History API (when a history provider is installed) using the recorded value nearest the entry datetime, kept only within per-path tolerances (±5 s for heading/COG, ±60 s for speeds/wind/position/nextPoint, ±10 min for pressure/log/engine hours/weather observations). Lookups are bounded (2 s), read-only, and never fail or delay the write; `enrich: false` skips them for bulk imports
- Writes through the resources API default to `origin: 'agent'`, set `timestamp` on every write, and stamp the entry-level `$source` on reads. Unknown fields and unknown telemetry paths are preserved verbatim (open content model); the legacy single-engine `engine.hours` scalar is served on reads as a `propulsion.default.runTime` pathvalue in seconds and dropped on writes, so a read-modify-write migrates entries to the per-engine canonical form
- A one-time startup migration stamps a UUID `id` on every pre-existing entry (backing up the touched day files to `id-migration-backup/` in the plugin data directory), builds an in-memory id → date index, and deduplicates entries an interrupted cross-day move may have left in two files. Every entry written from now on carries its `id`, including v1 writes
- The entry JSON Schema for the `logentries` resource, `schema/logentries.schema.json`, is published in this repository as the machine-readable contract for third-party logbook apps
- The logbook display time zone can now be set to either UTC or the vessel's ship's time (the `environment.time.timezoneOffset` offset published by signalk-ships-time, which the plugin now recommends). The chosen time zone drives how entry timestamps render — ship's time without a timezone specifier, UTC with an explicit `Z` — as well as which days of entries the logbook loads and where its day breaks fall. Entries remain stored in UTC

### Changed
- The webapp now reads and writes entries through the Signal K v2 Resources API (`/signalk/v2/api/resources/logentries`) instead of the plugin's private v1 routes: listings use a single ranged query following the display time zone, edits are plain PUTs on the entry's stable id, new entries are POSTed with `origin: manual` and a client-resolved datetime, and React list keys use the entry id so same-millisecond entries render safely. A client-side representation adapter (`src/helpers/entries.js`, reusing the provider's translation) keeps all entry rendering and editing in the nautical shape the UI has always used
- The v1 `/logs` REST routes are deprecated in favor of `/signalk/v2/api/resources/logentries` (no removal scheduled): every v1 response carries `Deprecation: true` and a `Link` header pointing at the contract document, and each v1 hit is written to the server debug log so operators can identify which installed plugins still call it. The v1 routes are now also registered at the same access levels the resources API enforces — GETs at `readonly`, writes at `readwrite` — via `router.access()` on servers that support it (older servers keep the plugin router's admin-only default); the OpenAPI document marks all `/logs` operations deprecated
- Every stored entry now carries a stable `id`, so v1 API responses include it too; entries created through the v1 API get an id assigned at write time
- Write validation follows an open content model: unknown entry fields are preserved instead of rejected, `origin`/`category` accept values beyond the recommended vocabulary, and the VHF channel field accepts alpha-suffixed and private channels (`16A`, `M1`)
- The "Select the display time zone" plugin setting no longer offers the full IANA zone list; setups still holding an IANA zone display entries in UTC until reconfigured

## [0.13.2] - 2026-09-28
### Added
- Ship's time changes are logged automatically: when the vessel's timezone offset (`environment.time.timezoneOffset`, as published by signalk-ships-time) changes, an entry like "Changed ship's time to UTC+13" or "Changed ship's time to UTC-9:30" is written

## [0.13.1] - 2026-09-27

## [0.13.0] - 2026-09-27
### Changed
- The webapp now builds against React 19 (and reactstrap 9.2.3), matching the React version provided by the Signal K admin UI through the Module Federation shared singleton. Previously the plugin was built against React 16 and only ran on the host's newer React through a version-mismatch fallback

### Fixed
- The log map now always offers OpenStreetMap as a selectable chart option, also when other charts are configured — setups whose only chart is a data layer (such as the distance-to-shore plugin's world coastline tiles) get a usable basemap again instead of being stuck on bare coastline geometry. The chart selected in the map is remembered between visits

## [0.12.0] - 2026-08-28
### Added
- The selected tab (Timeline, Logbook, Map) is now tracked in the URL hash, so a reload keeps you on the same tab, tabs can be shared as links (`#book`, `#map`), and browser back/forward switch between tabs
- The log map now renders every configured chart with MapLibre GL: raster tile charts through a generated raster style, and vector tile charts (e.g. Open Waters `.pbf` served through signalk-charts-provider-simple, addressing #100 the right way and reverting the #102 workaround) through a style generated from the chart's source layers. When signalk-corridor-tile-downloader has mirrored the upstream chart style, that style is mounted with its full symbology (base map, bathymetry, labels); the downloader's raw `Signal K Corridor Cache` charts stay hidden from the layer switcher. pigeon-maps has been dropped along with its SVG rendering quirks, and the map zooms to fit the track, re-fitting when the position history resolves

### Fixed
- The map no longer flashes the network-based OpenStreetMap default (and loads its tiles) while the configured chart list resolves; a loading placeholder shows until the chart list is known
- The log map track now uses the Signal K **v2** history API (`/signalk/v2/api/history/values`, duration-based ranges), which the history providers actually serve

## [0.11.4] - 2026-08-18
### Fixed
- Sail configuration is again shown in the UI, and the sails editor works with full sail data

## [0.11.3] - 2026-08-07
### Fixed
- Repeated looping crew list and sail configuration requests

## [0.11.2] - 2026-07-27
### Fixed
- "Stopped" automatic log when moored after sailing works again

## [0.11.1] - 2026-07-18
### Fixed
- Signal K deltas are now handled in sequence to guard agains duplicate trigger firings

## [0.11.0] - 2026-07-14
### Added
- Identification capability between manual, automatic, and AI-written entries (the last identified with the [EU-recommended label](https://digital-strategy.ec.europa.eu/en/policies/eu-icons-labelling-ai-generated-content))
- Automatic logging of major heading changes (tack, gybe, etc). Opt-in.
- Automatic logging of current skipper name (and skipper changes)

### Fixed
- Added file write queue, so simultaneous log writes should not longer risk corrupting the current log file

## [0.10.0] - 2026-07-09
### Added
- You can now choose the chart provider to use with the map feature
- Log entries can be made for arbitrary date and time and not only "N minutes ago"

### Fixed
- "N minutes ago" now shows the selected value
- Crew list modification logging

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
