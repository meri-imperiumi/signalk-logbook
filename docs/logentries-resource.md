## Summary

Expose logbook entries as a Signal K v2 **Resource** of type `logentries`, with this plugin acting as the reference Resource Provider. Other plugins read and write log entries through the standard Resources API (`app.resourcesApi` / `/signalk/v2/api/resources/logbook`), and the entry schema becomes a documented, implementation-neutral contract that other logbook apps can target. Entries carry stable UUID identifiers; grouping entries into trips is deferred to a later revision — a dedicated Trips Resource holding trips as start/end intervals (a generic opaque group-id mechanism was a review suggestion) — and the standard schema carries no voyage-boundary marker (see Trips).

The intention is to use the [signalk-logbook plugin](https://github.com/meri-imperiumi/signalk-logbook) as the **reference implementation and testbed** for the contract.

The document is split in two parts:

- **Part 1 — Specification**: the `logentries` resource contract — identity, entry schema, listing, access patterns, permissions, provider requirements, interchange format. Implementation-neutral, written to be proposed upstream.
- **Part 2 — Implementation plan**: signalk-logbook as the reference implementation — **all automations** (auto-entry triggers, enrichment, write defaults), storage, migration, v1 API compatibility, UI migration, and the step-by-step plan.

# Part 1 — Specification: the `logentries` resource

## Goals

1. **Programmatic access for plugins**: any server plugin can append, read, edit, and delete log entries without talking to a provider's private REST API or touching its files.
2. **Interoperability**: a standardized log entry schema (telemetry as normal Signal K paths, SI units, enumerations) so independent logbook UIs, exporters, and analyzers can work against any conforming provider.

## Non-goals

- Standardizing any provider's UI or auto-entry triggers (autopilot on/off, notification episodes, hourly entries). Those are implementation automations (Part 2) that keep working as internal writers through the same storage.
- Defining multi-vessel or multi-logbook setups. One `logentries` type per server, for the self context.
- Trip grouping. Entries carry no trip identifier; grouping arrives in a later revision, either as the review-sketched generic opaque group-id mechanism or as a dedicated Trips Resource — a decision deliberately left open (see Trips).
- Queryable history/analytics API. Consumers needing aggregates use `from`/`to` listing and compute their own.
- Evidentiary signing or stamping of entries, revision history, and soft-delete. Out of scope for this revision (see meri-imperiumi/signalk-logbook#90 and Open questions).

## Background: SK v2 Resources mechanics

- A plugin calls `app.registerResourceProvider({ type, methods })` with `listResources(query)`, `getResource(id, property?)`, `setResource(id, value)` and `deleteResource(id)`.
- The server then serves the type at `GET/PUT/DELETE /signalk/v2/api/resources/<type>/<id>`, `POST /signalk/v2/api/resources/<type>`, and forwards websocket `PUT resources.<type>.<id>` to the provider.
- Other plugins call `app.resourcesApi.listResources / getResource / setResource / deleteResource` without caring which plugin serves the type.
- Resource types beyond the standard five (`routes`, `waypoints`, `notes`, `regions`, `charts`) are allowed as custom types, so we do not need an upstream spec change to ship — but the schema is designed to be proposed upstream later. (The server's `SignalKApiId` feature enum already reserves `logbook` for a future feature; the resource type here is deliberately named `logentries` so it does not stake a claim on that id — see Resource type.)
- The server allows **one provider per resource type** — a second `registerResourceProvider` for `logentries` fails. One log-entries provider per server is therefore the deployment model: consumers pick an installation, not a provider among several; alternative implementations run on their own servers against the same contract.

## Resource type: `logentries`

Why a new type instead of reusing `notes`:

- `notes` are geo-anchored (position/region, optional) with no time-series semantics. Log entries are time-anchored — a line records a moment in time, exactly like a paper logbook.
- Log entries carry structured navigation/weather observations that have no home in the `notes` schema.

Why `logentries` and not `logbook`: a resource type names its instances — `resources/routes/<id>` addresses one route — so `resources/logbook/<id>` would read as "one logbook", yet each resource here is a single line: a log entry, not a logbook. The logbook is the collection the entries compose (review feedback insisted on the distinction), and the type name stays clear of the `logbook` feature id the server API already reserves (see Background).

Why not `logs`: `log` is overloaded in Signal K (`navigation.log` is the distance log).

## Identity: UUID resource ids, datetime as data

- **Resource id = a UUID** (v4, canonical string form). `POST` lets the server generate it; `PUT` accepts a client-chosen UUID. The entry's `datetime` is a field of the entry, not the id.
- Rationale (from discussion with other logbook app maintainers):
  - **POST works.** The server generates the id and hands the client a usable resource URL; everything the client then does with that URL (GET, PUT, DELETE) just works. Generic resources clients need no special-casing.
  - **Editing is a plain PUT.** Replacing an entry's content — or correcting its datetime — is a single upsert on the stable id. No two-call move procedure, no adjacent-millisecond dance, no failure window between calls.
  - **Stable references.** Links, external notes, and analyzer caches keep pointing at the same entry even after a datetime correction.
  - **Same-millisecond entries are allowed.** A trigger firing as a crew member logs the same event produces two entries, not a silent clobber.
- Normative rules:
  - **Ids MUST be UUIDs.** `setResource` rejects non-UUID ids with 400.
  - **A payload `id`, if present, MUST equal the resource id** (400 otherwise); the provider stamps the canonical id onto the stored entry regardless.
  - **`datetime` is RFC 3339 UTC**, 400 if invalid. When omitted, it defaults to *now* on create and is preserved on replace — the provider cannot distinguish POST from PUT (both arrive as `setResource(id, value)`), so the rule is uniform. `datetime` remains the chronological sort key.
  - **`setResource` is a standard create-or-replace upsert** on the id. Datetime uniqueness is not assumed anywhere: two entries may share a timestamp; they are ordered deterministically (by `datetime`, then id).
  - **POST is not idempotent**: a client retrying after a lost response may create a duplicate line. Consumers that need idempotent writes PUT their own UUID.
- Alternative considered: datetime ids (the first draft of this document). A thin wrapper over current storage and naturally sorting, but they break POST, force a conflict rule plus move-procedure edits, and make references unstable when a time is corrected. Maintainer feedback settled this: UUID ids.

## Entry schema

Two kinds of content, split by a simple rule — anything addressable as a Signal K path lives in the telemetry array, and only the logbook's own fields sit at the top level:

- **Snapshot — the `telemetry` field**, an array of flattened delta pathvalues — `{ "path": …, "value": …, "$source"?: … }` — the form used in delta updates and History API responses: vessel state (position, speeds, weather), engine data, and radio/crew context (`communication.*`) alike. Values are Signal K SI and follow the specification's value shapes, so a pathvalue holds exactly what the corresponding path holds. The array (not an object) is deliberate: the same path may appear more than once, each pathvalue with its own `$source`, so an entry can carry multiple simultaneous values for a path following the server's Multiple Values logic.
- **Logbook fields** — the line itself and its metadata — keep their names: `id`, `datetime`, `text`, `author`, `origin`, `category`.

(The reference implementation's v1 API and YAML storage keep their historical field names — the provider translates at the boundary, Part 2.)

Entry fields:

| Field | Type | Units / values | Notes |
|---|---|---|---|
| `id` | string UUID | — | Equals the resource id. Stored, and echoed in read responses. |
| `datetime` | string, RFC 3339 UTC | — | Chronological sort key; defaults to now on create (see Identity). |
| `text` | string | — | Required. The log line itself. |
| `telemetry` | pathvalue[] | — | Optional snapshot: one flattened delta pathvalue per Signal K path, `{path, value, $source?}` — vessel state, engines, radio and crew context alike; see the telemetry paths below. Absent when nothing was captured. |
| `author` | string | — | Crew member the line is attributed to. Free text, not an audit identity; delegation is a feature — the writing principal may differ (see Audit trail). |
| `origin` | enum | `manual` \| `auto` \| `agent` | `manual` = typed in UI; `auto` = trigger/hourly/notification; `agent` = machine writing on behalf of a human. |
| `category` | enum-like | `navigation` \| `engine` \| `radio` \| `maintenance` | Recommended set; other strings allowed. |

Telemetry paths — each row is a `{path, value, $source?}` pathvalue inside the `telemetry` array; this is the recommended core set, and any other Signal K path may ride along (open content model below):

| Path | Type | Units / values | Notes |
|---|---|---|---|
| `navigation.position` | object | `{latitude, longitude, altitude?, source?}` | WGS84, the `navigation.position` value shape. `source` is a logbook extra naming the fix origin — free text, today filled from the live `navigation.gnss.type` path (the specification's GNSS type), with the reference UI offering `GPS`, `GNSS`, `Visual`, `Radar`, `Celestial`, `DR` for manual origins; no enum in this contract. |
| `navigation.log` | number ≥ 0 | meters | Total distance-log reading. |
| `navigation.course.nextPoint` | object | `{position: {latitude, longitude}, href?}` | Current destination, in the server Course API's `nextPoint` shape. `href` optionally references `resources/waypoints` when the writer knows one — a nextPoint off the MFD doesn't. |
| `navigation.headingTrue` | number 0–2π | radians true | |
| `navigation.courseOverGroundTrue` | number 0–2π | radians true | COG. |
| `navigation.speedOverGround` | number | m/s | |
| `navigation.speedThroughWater` | number | m/s | |
| `environment.outside.pressure` | number | Pa | |
| `environment.wind.speedOverGround` | number | m/s | |
| `environment.wind.directionTrue` | number | radians true | |
| `environment.water.seaStateValue` | number | Beaufort 0–12 | The crew's sea-state estimate as the numeric Beaufort code — the ecosystem's numeric sea-state path; see Weather observation paths. |
| `environment.outside.cloudCover` | number | ratio 0–1 | Total cloud cover (n oktas = n/8); see Weather observation paths. |
| `environment.outside.visibility` | number | 0–9 | See Weather observation paths. |
| `propulsion.<instance>.runTime` | number | seconds | One pathvalue per engine instance, like the live `propulsion.<instance>.runTime` paths; multi-engine capable and the only engine shape in the resources API. (The reference implementation's storage and v1 API keep `hours` — Part 2.) |
| `communication.vhf.channel` | string 1–3 chars | channel | Allows alpha-suffixed (`16A`) and private (`M1`) channels. Not in the SK specification — a convention this plugin already reads, and a candidate for the upstream proposal. |
| `communication.crewNames` | string[] | — | |
| `communication.skipperName` | string | — | |

### Weather observation paths

Sea state, cloud cover, and visibility are observations the crew makes, not instrument readings. The rule for carrying them: where the ecosystem already has a path — or one in active proposal — the observation rides that path in its units, one path and one scale, rather than a near-duplicate three letters away in different units:

- `environment.water.seaStateValue` — the crew's estimate rides the ecosystem's numeric sea-state path as **Beaufort force 0–12**. The label companion `environment.water.seaState` is deliberately **not** carried: neither the specification nor the server defines the string vocabulary, and nmea0183-signalk writes Beaufort wind descriptions ("gentle breeze, 3.4-5.4 m/s") on that path for AIS meteo stations (VDM.ts), where IMO SN.1/Circ.289 Table 1.2 describes the sea — emitting state-of-sea labels there would collide with that convention and put two different vocabularies on one path. Consumers wanting words can map the numeric code themselves through the standard WMO Douglas↔Beaufort correspondence. (An earlier draft of this document carried the estimate as a number on `seaState` itself, then as a number plus a derived WMO state-of-sea label; both were dropped — the former for conflicting with the label convention, the latter for the undefined vocabulary.)
- `environment.outside.cloudCover` — total cloud cover as a **ratio 0–1**, the path and unit of the upstream meteo proposal (SignalK/specification#662). The okta — the WMO unit mariners estimate sky cover in — converts exactly (n oktas = n/8), so crew estimates, instruments, and models are interchangeable on one path; UIs that prefer oktas band the ratio.
- `environment.outside.visibility` — visibility on a 0–9 descriptive scale (0 dense fog … 9 excellent), the bands logbook UIs offer. There is no instrument counterpart to reuse (specification#662 proposes `environment.outside.horizontalVisibility` in meters); descriptive code versus meters is an open question (below).

Only the visibility path is a new proposal to take upstream with this schema — sea state and cloud cover reuse what already exists, and where a counterpart exists, a logbook line and a meteo feed differ in *who* observed, not in path or units. The observation codes remain what they always were: scales mariners actually report, with no SI value to convert to.

Conventions (normative for the standard):

- **Telemetry pathvalues are Signal K delta values**: path name, unit, and value shape come from the specification where it defines the path — speeds m/s, angles radians true, distances meters, pressure Pa, engine run time seconds — so values flow in and out of deltas and the History API without conversion or translation. Beyond `path` and `value`, a pathvalue may carry the delta value members `$source` (a sourceRef naming which source the value came from) and `timestamp` (its sample time); both are data and are preserved verbatim. (The reference implementation converts to nautical storage units at its boundary — Part 2, Storage.) UIs render SI values through Signal K unit preferences rather than hardcoding nautical display.
- **Open content model**: consumers MUST ignore unknown fields and unknown telemetry paths. Providers MUST preserve unknown fields verbatim on write — including unknown telemetry paths and extra pathvalue members. This lets other apps extend entries without breaking anyone. Top-level extension fields SHOULD be prefixed with the writing application's namespace (e.g. `x-stylusapp-ink`); un-prefixed top-level names are reserved for future standard additions. Telemetry extension paths SHOULD use a namespaced root segment (Signal K's `proprietary.*` convention) rather than squatting on spec namespaces. (Requires relaxing the plugin's current `additionalProperties: false` write validation. Sole exception: the legacy `engine.hours` scalar is dropped on write — see Provider requirements.)
- **`origin`/`category` are open enumerations**: the listed values are the recommended vocabulary; implementations must not reject unknown values.
- **`schemaVersion` is a reserved field**: optional integer, absent = `1`. Reserved so a known field can change meaning later without inventing a new resource type; other writers MUST NOT use the name for anything else.
- Provider responses add an entry-level `$source: <providerPluginId>` following resource conventions, and set entry-level `timestamp` (record modification time) on every write — create and replace alike (see Audit trail). Both are stripped on write. They are distinct from a telemetry pathvalue's own `$source`/`timestamp` (data about where and when that *value* was sampled), which are preserved.
- JSON example of a stored entry:

```json
{
  "id": "1b4e28ba-2fa1-11d2-883f-b9a761bde3fb",
  "datetime": "2026-01-17T09:01:00.000Z",
  "text": "Autopilot activated",
  "telemetry": [
    { "path": "navigation.position", "value": { "latitude": 52.511, "longitude": 13.1936, "source": "GPS" } },
    { "path": "navigation.headingTrue", "value": 3.3161 },
    { "path": "navigation.courseOverGroundTrue", "value": 3.351 },
    { "path": "navigation.speedOverGround", "value": 2.6751 },
    { "path": "navigation.speedThroughWater", "value": 2.6237 },
    { "path": "navigation.log", "value": 237796.8, "$source": "signalk-n2k.CanBus0.160" },
    { "path": "environment.wind.speedOverGround", "value": 6.5334 },
    { "path": "environment.wind.directionTrue", "value": 1.5621 },
    { "path": "environment.outside.pressure", "value": 101325 },
    { "path": "environment.water.seaStateValue", "value": 3 },
    { "path": "communication.crewNames", "value": ["Alice", "Bob"] },
    { "path": "communication.skipperName", "value": "Alice" }
  ],
  "author": "",
  "origin": "auto",
  "category": "navigation",
  "timestamp": "2026-01-17T09:01:02.114Z",
  "$source": "signalk-logbook"
}
```

The authoritative JSON Schema lives in `schema/` (extracted from `openapi.json` `components.schemas.Entry` plus the relaxations above) and is the artifact proposed upstream.

## Trips

Entries carry **no trip identifier and no voyage-boundary marker**. Grouping entries into trips is the job of a dedicated **Trips Resource**, planned as a separate, later specification: a trip is scoped there as an interval — start and end timestamps — and consumers of the log-entries resource fetch between those boundaries (see Listing) — no per-entry tagging required. What this contract contributes is the chronological data: every entry's `datetime`.

An earlier revision carried an `end: true` voyage-end marker on the entry that closed a voyage. With trips as intervals in their own resource, that marker stored a trip boundary a second time — once on the entry, once as the Trips Resource's end timestamp — and went stale whenever the boundary moved afterwards: a corrected entry datetime or an edited trip end left the marker pointing at a voyage close that no longer was one. The standard schema therefore drops it; trip boundaries belong to the Trips Resource alone. The stop itself needs no marker — it is already expressible as telemetry, `navigation.state` anchored/moored.

Review sketched a **generic alternative** to a dedicated Trips Resource: entries could carry an opaque `groupId` — or a `groupIds` array — with a `group` listing filter, and apps could then manage whatever grouping they want (trips, legs, rallies, maintenance campaigns) on top of time-based retrieval. Attractive, and deliberately not standardized in this revision: no entry semantics need the field yet, it is backward-compatible to add later, and the open content model lets apps prototype today with namespaced extension fields (e.g. `x-triplog-groupIds`). The choice between the two paths is open (Open questions).

## Audit trail

Professional logbooks can carry evidentiary weight, and review feedback asked for an audit story. This revision's scope is deliberately narrower:

- **`author` is attribution, not audit.** Free text naming the crew member the line is attributed to; delegation is a feature — on vessels with multi-user terminals, or in "could you write this down for me?" situations, the line should credit the speaker, not the typist. **Default**: a write arriving with an authenticated principal and no `author` gets `author` set to that principal — in practice only write surfaces that can see one (the reference implementation's v1 routes; the resources API passes no principal, see below).
- **`timestamp` is set on every write** (create and replace alike), giving a minimal when-was-this-last-touched signal.
- **Providers cannot see the writing principal.** Resources API provider methods receive only `(id, value)` — no request object — and in-process `resourcesApi` calls have no principal at all. Principal-stamping through the resources API therefore needs upstream server support (see Open questions); it cannot be a provider-side feature.

Explicitly out of scope here: revision history and soft-delete (edits and deletes currently leave no trace), entry signing/stamping (meri-imperiumi/signalk-logbook#90), and an append-vs-edit/delete permission split (the resources API writes at a uniform `readwrite`). Two crew editing the same entry from different devices can silently lose one edit — there is no optimistic concurrency in the resources API (see Open questions).

(The reference implementation's on-disk version-control audit story is an implementation note — Part 2, Storage.)

## Listing and filtering

`listResources(query)` supports:

| Param | Format | Meaning |
|---|---|---|
| `date` | `YYYY-MM-DD` | Single UTC day. |
| `from`, `to` | RFC 3339 | Inclusive datetime range (may span days). |
| `bbox` | `lon,lat,lon,lat` | Only entries with a `navigation.position` pathvalue inside; entries without one are excluded. |
| `category`, `origin`, `author` | string | Equality filter. |
| `limit` | integer | Return the N most recent matches (selection happens before the ascending ordering). |
| `dates` | `true` | Day-calendar summary: which dates contain entries. Non-normative convenience; see below. |

- **No silent windows**: a listing MUST carry at least one of `date`, `from`/`to`, or `limit` — otherwise 400 with a message saying so. The standard resource map has no room for truncation metadata, so a consumer could never distinguish "nothing older" from "a window was applied"; an explicit window or an explicit `limit` makes every response complete by construction. This replaces the first draft's default 7-day window. (`dates=true` alone is exempt — the calendar summary is itself complete, never truncated.) Generic resources clients that list a type without parameters will hit this 400 — intentional, not a bug; the error message names the accepted parameters.
- `dates=true` returns a **day-calendar summary** instead of entries: `{ "<YYYY-MM-DD>": { "count": <n> }, ... }` for the requested range, or for all history with no range. Every list UI wants this and deriving it from range listings across years is the expensive path, so the param earns its place. The response is not the standard entry map; `count` may grow sibling fields later. Non-normative: a provider convenience, candidate for the upstream proposal.
- `limit` applies **before** the ordering: the N newest matches are selected, then presented ascending — so `limit: 10` with no time filter means "the 10 most recent entries", the common UI case.
- Response is the standard resource map: `{ "<uuid>": <entry>, ... }`.
- Ordering is chronological (ascending) by `datetime`; ids are UUIDs and do not sort meaningfully, so ties (same millisecond) are broken by id for determinism.

## Access patterns

**Other plugins (server-side), the primary use case:**

```js
// Append a line now — id is a fresh UUID, datetime defaults to now
await app.resourcesApi.setResource('logentries', crypto.randomUUID(), {
  text: 'Genoa furled',
  origin: 'agent',
  author: 'deck-app',
  category: 'navigation',
});

// Read a range
const entries = await app.resourcesApi.listResources('logentries', {
  from: '2026-01-01T00:00:00.000Z',
  to: '2026-01-31T23:59:59.999Z',
});

// Backdate a line from 3 hours ago — missing telemetry paths may be auto-filled
// by the provider (Part 2, Enrichment)
await app.resourcesApi.setResource('logentries', crypto.randomUUID(), {
  datetime: new Date(Date.now() - 3 * 3600 * 1000).toISOString(),
  text: 'Sail change in the squall',
  origin: 'agent',
});

// Edit an entry in place — same id, one call, content or datetime
await app.resourcesApi.setResource('logentries', entryId, {
  ...entry,
  text: 'Genoa furled, second reef in',
});
```

**REST clients:**

```
GET    /signalk/v2/api/resources/logentries?from=...&to=...
POST   /signalk/v2/api/resources/logentries                       { entry }
GET    /signalk/v2/api/resources/logentries/1b4e28ba-2fa1-11d2-883f-b9a761bde3fb
PUT    /signalk/v2/api/resources/logentries/1b4e28ba-2fa1-11d2-883f-b9a761bde3fb { entry }
DELETE /signalk/v2/api/resources/logentries/1b4e28ba-2fa1-11d2-883f-b9a761bde3fb
```

**Websocket:** `PUT resources.logentries.<uuid>` with the entry value on the self context; subscribers see `resources.logentries.*` updates like any resource. The server's AsyncAPI docs confirm resources emit change deltas under `resources.{type}.{id}` (subscribable via `resources.*`). WS write handling routes through the same write checks as HTTP (see Permissions).

**POST creates entries**: the server generates the UUID id and calls `setResource` with it; the body needs no `id` (an omitted `datetime` defaults to now — see Identity). POST is not idempotent — retrying after a lost response may duplicate a line; consumers needing idempotency PUT their own UUID.

## Permissions

The short version: **the v2 Resources API gives reads at `readonly`, writes at `readwrite`, no admin needed, and no tokens at all for in-process plugin access.**

Why plugin-private routes often need admin: the server mounts plugin routes under `/plugins/<pluginId>` behind `pluginAuthenticationMiddleware`, and **any route registered directly on the plugin router defaults to admin-only**. (`router.access('readonly'|'readwrite')` is the escape hatch for plugin routes, available on current 2.x servers.) The v2 resources routes are not plugin routes — they are server routes that forward to providers — so they get the server's standard access levels:

| Access path | Requirement |
|---|---|
| In-server plugins via `app.resourcesApi` | **None.** Plain function calls inside the server process; no request object, no token, no security middleware in the path. |
| REST `GET /signalk/v2/api/resources/logentries...` | Any valid token (`readonly`, `readwrite`, or `admin`). Anonymous read only if the admin has enabled *allow read only* (`allow_readonly`); otherwise 401. |
| REST `PUT`/`POST`/`DELETE` on `/signalk/v2/api/resources/logentries...` | `readwrite` or `admin` token (403 otherwise). Enforced twice: the global write middleware on `/signalk/v2/*` and `shouldAllowPut(req, 'vessels.self', null, 'resources')` in the resources routes — both accept `readwrite`. |
| WS subscribe to `resources.logentries.*` | Read level, same as GET; subject to ACL-based delta filtering. |
| WS `PUT resources.logentries.<id>` | `readwrite`/`admin` principal on the connection (`shouldAllowWrite`). |
| Server with security disabled (dummy) | Everything open. |

ACLs: if the admin configures path ACLs, resource writes are additionally filtered via `checkACL(..., 'resources', 'put')`; by default (no ACLs) all `readwrite`+ principals may write. Providers do not need to do anything for this — it happens in the server before provider methods are called.

## Provider requirements

- **Create-or-replace (standard upsert)**: `setResource(id, value)` validates the id as a UUID (400 otherwise), rejects a payload `id` that differs from the resource id, and creates or replaces the entry at that id. `datetime` follows the Identity rules (defaults to now on create, preserved on replace, 400 if invalid). The fields the provider would otherwise default or auto-fill follow the same split: `origin`, `author`, and `telemetry` omitted on a replace keep their stored values — so an API edit does not turn a `manual` line into an `agent` one — while a supplied `telemetry` array (even empty) is taken as sent, making path removal a one-call PUT. Same-millisecond datetimes are not errors; they coexist as distinct entries. Editing an entry's content *or* datetime is one call — no conflict rule, no move procedure.
- **Datetime is data, but stays the sort key**: entries are ordered by `datetime`, ties broken by id for determinism. Providers may partition storage by datetime; when a replace changes `datetime`, the entry moves between partitions internally while the id and everything referencing it stays stable.
- **Engine keys**: the resources API speaks only `propulsion.<instance>.runTime` (seconds) — one pathvalue per engine instance, matching the live path family. The legacy scalar form does not exist in the API: on read, scalar-only entries are served as a `propulsion.default.runTime` pathvalue and the scalar is stripped from responses; on write, the scalar is **dropped, not interpreted and not preserved** — a targeted exception to open-content preservation for this one known-legacy field. Since reads never return the scalar, read-modify-write cycles converge on the canonical pathvalues.
- **Out-of-range values park, never reject**: the standard schema carries no ranges; the reference implementation's storage does. A known path whose value has no representable storage form — a heading outside 0–2π, a negative speed or distance log, a position outside the WGS84 bounds, a visibility code above 9, a VHF channel beyond three characters — is parked verbatim in the entry's `telemetry` array like an unknown path (see the open content model). The write never fails for a value the standard schema accepts, and reads return the parked pathvalue exactly as sent.
- **Auto-fill is optional**: fields beyond `text` are optional, and `telemetry` itself is optional. A provider MAY fill omitted paths from vessel data before storing — a path already present in the array is never added a second time — and writers MUST NOT rely on any particular path being filled. (The reference implementation's tiered enrichment is Part 2, Enrichment.)
- **Errors**: `getResource`/`deleteResource` on unknown ids reject with ENOENT → HTTP 404; invalid ids, a mismatched payload `id`, an invalid `datetime`, and validation failures reject with the message → 400.

## Interchange format

The API is the interop contract — including for offline exchange. The interchange serialization is the **resource representation itself** (SI units, open content model, `id`, unknown fields): a full export is `GET /signalk/v2/api/resources/logentries?from=...&to=...`, and a conforming provider must accept exactly that back on import. Reads return exactly what was written, so an export/import round trip loses nothing that storage holds. (The reference implementation's storage-layer precision guarantees are Part 2, Storage.)

## Open questions

1. Optimistic concurrency: the resources API has no ETag/if-match, so two crew editing the same entry from different devices silently lose one edit. A reserved `revision` counter convention (client sends the expected revision, 409 on mismatch) is the possible provider-side fix — worth the API surface for log lines?
2. Evidentiary audit: revision history and/or soft-delete, and stamping the authenticated principal on writes separately from `author`. The resources API gives providers no principal (`setResource(id, value)` carries no request context; in-process calls have none at all), so this needs upstream support. Entry signing/stamping stays out of scope meanwhile (meri-imperiumi/signalk-logbook#90).
3. Attachments: photos, sketches, handwritten ink have no standard home; extension fields (`x-…` blob references) cover it meanwhile. Should there be a standard `attachments` shape, and does it belong with signing in the same future scope?
4. Visibility coding: `environment.outside.visibility` carries a 0–9 descriptive code, while the upstream meteo work (specification#662) carries instrument visibility in meters (`environment.outside.horizontalVisibility`). Keep the code, or carry meters and let UIs band them?
5. Grouping: standardize the opaque `groupId`/`groupIds` entry field with a `group` listing filter (see Trips), or wait for a concrete consumer? Backward-compatible to add later; namespaced extension fields cover early experiments.

# Part 2 — Implementation plan: signalk-logbook

signalk-logbook is the **reference implementation and testbed** for the Part 1 contract: it registers the `logentries` resource provider, serves the entry schema from `schema/`, keeps its existing UI and triggers, and stores entries in its YAML day files. Everything in this part is implementation-specific — in particular, **all automations live here, none of them are contract**: the spec defines fields and lifecycle semantics; how lines get written and stamped automatically is up to the provider.

## Automations

The plugin's automatic behaviors, all writing through the same storage as manual lines:

### Auto-entry triggers

The existing triggers — autopilot on/off, notification episodes, hourly entries — keep working unchanged as internal writers that happen to go through the same storage; their lines carry `origin: 'auto'`. The existing `Anchored`/`Stopped` trigger lines additionally write a legacy `end: true` marker — the voyage-end convention the plugin has always stored. Its semantics are unchanged (trip end, never day end; a voyage is anchor-to-anchor or berth-to-berth, so a lunch anchoring closes it and the next departure opens a new one — for a long-haul cruiser who is rarely moored, anchorages *are* the voyage boundaries). The marker is **not part of the standard schema** (Part 1, Trips): the open content model preserves it as an unknown field, and the plugin's future trips builder — reading these legacy markers rather than re-inferring boundaries — is what turns them into Trips Resource intervals.

### Enrichment (semi-automatic fills)

Tiered enrichment is what makes this plugin "semi-automatic": it fills only telemetry paths the payload omits — a path already present in the array is left untouched, explicit pathvalues always win. Both tiers source Signal K-native SI values and emit delta pathvalues directly (deltas and the History API speak radians/m/s/Pa natively), so enrichment needs no unit conversion or reshaping on the API side; conversion to nautical happens once, at the storage write (see Storage). The buffer tier reads the same paths the telemetry array carries; for sea state it also accepts the legacy `environment.water.swell.state` path earlier versions of this plugin read. Enrichment is a create-time convenience: it fills the paths a new entry's telemetry array omits. A replace (`setResource` on an existing id) is taken as sent — omitted `telemetry` preserves the stored snapshot, and a supplied array replaces it with no refills, so removing a path is one PUT — unless the payload explicitly asks for fills with `enrich: true`.

- **Enrichment control**: the write payload may carry `enrich` (boolean, default `true` on create; a replace only enriches when it explicitly carries `enrich: true`). It is a control field — stripped before storage, never persisted. `$source`, which the provider adds on read, is likewise stripped on write. `enrich: false` stores exactly what was sent — and is the **bulk path**: each history-tier lookup costs a bounded timeout of its own, so an importer backfilling a season pays that on every line. Writers that already carry their data (digitized paper logbooks, delayed trip reports, migrations between installs) should send `enrich: false` and skip the lookups entirely.
- **Buffer tier**: entry datetime is *now* or up to 15 minutes in the past — values come from the live state circular buffer, exactly like today's `POST /logs` with `ago`.
- **History tier**: any older backdated datetime, however far back — bounded only by what the History API provider holds, no configured window. If the server has a History API provider (`app.getHistoryApi()` — in-process, no tokens, available e.g. with signalk-history-sqlite), the provider issues one `getValues` call for the captured paths over the widest tolerance window around the entry datetime and, per path, fills each missing path from the recorded value nearest the entry datetime — kept **only when it falls within that path's tolerance**. Enrichment is **per-path, not all-or-nothing** — partial enrichment is the common case — and a value outside its path's tolerance leaves the path absent rather than filled from stale data. Tolerances are **per path** (proposed defaults, tunable): `navigation.headingTrue` and `navigation.courseOverGroundTrue` are fast-changing — during a maneuver, a minute-old value describes a different boat — so they use ±5 s; the speed, wind, and position paths and `navigation.course.nextPoint` use ±60 s; slow-changing paths (`environment.outside.pressure`, `navigation.log`, engine `runTime`, the weather observation paths) use ±10 min, tolerating sparse sensors and intermittent sources. The lookup runs under a bounded timeout (2 s proposed) **outside** the per-date write queue — enrichment is read-only and needs no serialization; only the storage write is queued. On timeout or error the lookup is abandoned and the entry stores with whatever is already filled: a slow, hanging, or unavailable history provider delays only its own entry, never another writer's manual line, and never fails the write. Bulk backfills pay the per-entry lookup latency on their own writes; the escape is `enrich: false`, the bulk path (see Enrichment control). No history provider or no data at that time: stored un-enriched. With years of history on board, even importing years-old lines (digitized paper logbook, delayed trip reports) yields properly located entries.

  History-tier values are "nearest recorded value at that time", not a forensic snapshot: sources and sample times differ from the buffer tier. Good enough for log lines, and it makes backdated entries first-class. The v1 `POST /logs` keeps buffer-only semantics (behavior freeze).

### Write defaults

- **`origin` default**: entries *created* via the Resources API default to `origin: 'agent'` when not supplied (the manual UI keeps `manual`, triggers keep `auto`); a replace preserves the stored origin, and the same rule preserves an omitted `author` and `telemetry`. The `author` default is spec-side (Part 1, Audit trail).

### Resource deltas for internal writes

Triggers, hourly entries, notification entries, and the v1 routes write straight to storage, bypassing the resource provider — and the server only emits `resources.logentries.<id>` deltas for writes routed through the provider (see the server's resource provider docs, *Delta Notifications for Internal Resource Changes*). Without help, a client subscribed to `resources.logentries` would see the UI's writes but none of the automatic ones, and would have to poll. The plugin therefore emits these deltas itself: `Log.appendEntry`/`writeEntry`/`deleteEntry` resolve with the stored (or removed) entry, and a change listener emits `app.handleMessage(plugin.id, delta, 2)` — the resource representation as value, `null` on delete.

Emission is gated on the provider actually being registered (on servers without a resources API there are no `resources.logentries` subscribers to serve, and older servers may not honor the v2 flag that keeps resources out of the full model cache) and never fails the write it observes. The provider's own writes (`upsertEntry`/`deleteEntryById`) never pass the listener — the server deltifies those, and a second delta would duplicate it; the startup migration rewrites files below the listener too.

## Storage

The plugin's YAML day files are **storage and plugin backup** (restore, migration between installs of *this* plugin), not the interchange format — that is the resource representation (Part 1, Interchange format). *Historical* files are thin as a format others import from: their values were rounded once, at capture, to display precisions — speeds and wind 1 decimal place in knots, headings/courses integer degrees, `log` 1 decimal NM, barometer 2 decimals hPa, engine hours 1 decimal (`format.js`) — and that rounding is irreversible. **New captures store full precision**: no rounding at the storage write, so the interchange contract — a client reads back exactly what it wrote — holds exactly, and display rounding moves to the UI where it belongs. The files stay readable YAML and other tools may import them as a courtesy, but the contract is the schema plus the resources API:

- One file per UTC day: `<YYYY-MM-DD>.yml` in the plugin data directory.
- **Every entry stores its `id`** as a plain YAML field. The provider keeps an in-memory `id → date` index — built by scanning day files at startup (the same pass as the migration) and maintained on writes — so id-addressed operations find the right file. The scan also deduplicates by id: an entry duplicated across day files by an interrupted cross-day move (see below) keeps a single copy. Day files hold tens of entries, so rescans are cheap.
- **Storage units and field names stay as-is** (nautical — knots, degrees true, nautical miles, hPa, engine hours — and the historical field names: `heading`, `speed.stw`/`speed.sog`, `barometer`, `observations.*`, `crewNames`, `vhf`, …) — unchanged from today's files, so v1 readers, existing backups, and external tools reading the YAML keep working. The delta pathvalues exist only in the resources API representation: the provider translates paths to the historical field names and converts SI ↔ nautical at the resources boundary. Sea state is the one non-SI translation: storage's `observations.seaState` has carried the Douglas 0–9 code (the legacy `environment.water.swell.state` source and today's UI picker both speak Douglas), while the API carries the numeric Beaufort code on `environment.water.seaStateValue`, derived from the stored Douglas code (Part 1, Weather observation paths) — the number maps through the standard WMO Douglas↔Beaufort correspondence, approximate in both directions and the only translation in this plan that is not exact. New captures store full precision (no capture rounding); historical files keep their rounded values untouched. Reads convert exactly, so a resources API write/read round trip is lossless for new data.
- A YAML document containing the day's entries as a list, sorted ascending by `datetime` (ties broken by `id` for determinism), each entry in the historical field names and storage units — the on-disk shape is unchanged by this revision, beyond gaining the entry's `id`. Duplicate datetimes within a day are allowed.
- **Engine shape on disk**: storage and the v1 API keep `hours` for as long as v1 exists; the provider converts the API's `propulsion.<instance>.runTime` seconds to storage `hours` with the standard rounding at the boundary. Combined with the API-side rules (Part 1, Provider requirements), a bare read-modify-write round trip through the resources API *migrates* a legacy-shaped entry to the canonical storage form — the client never sees the scalar (reads strip it), the payload it PUTs back carries the normalized pathvalues, and the write drops any scalar — so the entry ends up canonical on disk with the data preserved and no stale duplicate. The v1 API continues to read whatever shape is stored (it already handles map-only entries from multi-engine boats).
- **Concurrency**: all writes go through the existing per-date serialized queue in `Log`. A PUT that moves an entry across a day boundary (changed `datetime`) is executed as **write-new-then-delete-old** — the entry is first written to the new day file, then removed from the old one, each step under its date's queue in that order. Concurrent writes to either file stay serialized, and a crash between the steps loses nothing: the startup index scan deduplicates by id (worst case a duplicate, never a loss). The `id → date` mapping is maintained in memory.
- `Log.sortDate` ordering and the date regex in `Log.js` are the normative details.
- **Audit on disk**: since the reference implementation uses YAML files on disk, these are easy to version control for audit trail, as is done for example [on Lille Ø](https://github.com/meri-imperiumi/log/tree/main/_data/logbook). Automatic [hard copy](https://github.com/meri-imperiumi/logbook-printer) is also doable.

## Migration for pre-existing entries

A one-time startup pass stamps every pre-existing entry with a fresh `id` (entries had none before this revision). Day files are rewritten in place, after the pass copies the originals to a backup directory — a migration that rewrites everything should be reversible by hand. The pass is idempotent (existing `id`s are kept, and re-running changes nothing once all entries are stamped) and runs before the provider registers. Downgrade note: an older plugin version reads migrated files fine, but its strict write validation (`additionalProperties: false`) strips `id`/extension fields if it *edits* a migrated entry — the files themselves and reads are otherwise unaffected.

## v1 API compatibility and deprecation

Many plugins call the v1 REST API (`GET/POST /logs`, `GET/PUT/DELETE /logs/:date/:datetime`), so **it stays** — the resources API is added alongside it, not as a replacement. The v1 routes keep addressing entries by `datetime`; since the resources API allows two entries at the same timestamp, v1 datetime addressing operates on the first (earliest) match — a documented limitation while v1 exists (duplicates only arise via the resources API). Once the resources API ships, the v1 routes are marked deprecated:

- **OpenAPI**: `deprecated: true` on all `/logs` paths in `openapi.json`, with descriptions pointing at `/signalk/v2/api/resources/logentries`.
- **HTTP headers**: every v1 response carries `Deprecation: true` plus a `Link: <migration-doc>; rel="deprecation"` header, so well-behaved clients can detect it programmatically. No `Sunset` header until an actual removal is decided — announcing a sunset date we don't intend to keep would be worse than none.
- **Server log**: `app.debug()` (not user-facing spam) when a v1 route is hit, so operators can identify which installed plugins still call it.
- **Behavior freeze**: v1 routes get bug fixes only, no new features — new capabilities (filtering, open schema, lower token levels, the multi-engine `propulsion.*.runTime` telemetry keys) exist only on the resources API, which is the incentive to migrate. The single-engine scalar `engine.hours` remains valid in the v1 API and storage for as long as v1 exists.
- Deprecation is informational: **no removal is currently scheduled**. If the debug logs ever show v1 usage has dried up, removal would be a major-version bump with a changelog entry and a Sunset header one release ahead.

The v1 routes and the resources provider share the same `Log` storage, so v1 callers and resources callers see each other's entries immediately — both surfaces are views on the same data, like the triggers and the UI already are.

## Access-level changes

Consequences of the Part 1 permission model for this plugin:

- The web UI no longer needs an admin token — a crew member with a `readwrite` device token can add and edit entries; `readonly` tokens can view (when logged in).
- Voice assistants / agent apps get long-lived `readwrite` device tokens instead of admin credentials.
- The legacy `/plugins/signalk-logbook/logs` routes stay (see v1 API compatibility), but should be re-registered via `router.access('readonly')` for the GETs and `router.access('readwrite')` for POST/PUT/DELETE so both surfaces enforce identical levels (guarding for older servers without `router.access`, where routes keep the server's default gating — safe). Admin tokens continue to work either way.
- Nothing admin-related remains in the logbook write path. Admin is only needed for plugin configuration (crew list defaults, trigger options) via the standard plugin config screen.

## Implementation steps

1. **Storage migration** (`plugin/Log.js`): a startup pass backfilling `id` on pre-existing entries (see Migration above), backing up day files before rewriting them in place idempotently, plus the in-memory `id → date` index with startup id-deduplication (see Storage) — all before the provider registers.
2. **Provider registration** (`plugin/index.js`): register `app.registerResourceProvider({ type: 'logentries', methods })` mapping to the `Log` class (`listDates`/`getDate`/`getEntry`/`writeEntry`/`deleteEntry`), plus filter logic and enrichment. Add `entry.datetime` defaulting (now on create, preserved on replace) and `origin: 'agent'` default for API writes.
3. **Schema**: extract the entry JSON Schema with open content model and open enums, adding `id` (UUID) and the `telemetry` pathvalue array; relax the plugin's write validation to match (preserve unknown fields, unknown telemetry paths, and extra pathvalue members through the YAML round-trip). The extracted JSON Schema file is the machine-readable contract for third parties — published in this repo (stable raw GitHub URL) rather than gated on the upstream proposal, so independent logbook-app authors can build against it now. A README section pointing at the resource API, the schema file, and this document completes the discovery path. `openapi.json` stays for the v1 routes and gains the deprecation markers in step 6.
4. **Smoketests**: provider methods against a temp dir — list with each filter param, the `dates=true` calendar summary, unfiltered listing rejected (400), get/set/delete round-trip, POST-style create with a server-generated UUID, PUT replace semantics (edit content and datetime in place, same id), duplicate datetimes coexisting, SI ↔ nautical unit conversion and telemetry-pathvalue ↔ historical-field-name translation (lossless for new captures: write SI → read SI → write again yields identical storage), the sea-state Douglas↔Beaufort boundary mapping (approximate, per Storage; the label path is not carried), duplicate telemetry paths (same path, different `$source`s) preserved verbatim, enrichment (buffer tier within the 15-minute window, history tier via a stubbed `app.getHistoryApi`, per-path partial fills, per-path tolerances (a `navigation.headingTrue` sample beyond its window leaves the path absent while an `environment.outside.pressure` value within ±10 min fills), graceful absence when it rejects, and the bounded-timeout fallthrough when it hangs), migration (id backfill, idempotent re-run), `enrich: false` bypass (the bulk path: consecutive `enrich: false` writes issue no history lookups), non-UUID id rejection, payload-`id` mismatch rejection, invalid `datetime` rejection, engine normalization (scalar-only legacy entry read as a `propulsion.default.runTime` pathvalue in seconds, scalar stripped from responses, scalar dropped on write, `runTime` → storage `hours` conversion, read-modify-write round trip migrates storage to the canonical form), unknown-field and unknown-telemetry-path preservation, ENOENT → rejection, cross-day move crash recovery (write-new-then-delete-old; a simulated crash between steps leaves a duplicate that the startup scan deduplicates), `timestamp` set on create and replace.
5. **UI migration**: switch the frontend to `/signalk/v2/api/resources/logentries` (token-level drop admin → readwrite is itself a user-visible change worth a CHANGELOG bullet) and render SI values through the server's unit preferences instead of hardcoded nautical display. Entry edits are plain PUTs on the entry id. (Status 2026-10-03: implemented — the API switch, id-based edits, and preference-driven rendering. Entries carry their original SI telemetry client-side; a display pass converts the shown values through the user's active unit preset (per-user override → server-wide preset, mirroring the admin UI), falling back to nautical units on servers without the unitpreferences API, and the write path is rebuilt from the SI telemetry plus the form-edited fields, so display conversion never leaks into writes and editing never degrades stored precision.)
6. **v1 deprecation**: mark the `/logs` paths deprecated as described above (OpenAPI flags, `Deprecation`/`Link` headers, debug logging) and align their access levels via `router.access()` where available.
7. **Upstream**: decoupled from the above — this repo already publishes the contract (schema file, this doc, README pointer), so interop does not wait on the Signal K specification. Once proven here, propose `logentries` as a standard resource type there with the schema and filter params; adoption would move the canonical home but not change the wire format. (Status 2026-10-03: this is under way as server-side work in signalk-server — see the 2026-10-03 Changes entry below. Steps 1–6 above are implemented in this repo.)

Natural first consumers to validate against: voice/deck apps writing `origin: 'agent'` lines. Trip-summary apps such as `signalk-triplogger` are the motivation for the planned Trips Resource rather than consumers of this contract.

## Open questions

1. Per-path enrichment tolerances (proposed: ±5 s for `navigation.headingTrue`/`navigation.courseOverGroundTrue`, ±60 s for the speed/wind/position paths and `navigation.course.nextPoint`, ±10 min for `environment.outside.pressure`/`navigation.log`/engine `runTime`/the weather observation paths) — right cuts, and should any path move between classes (e.g. `environment.wind.directionTrue`, which swings during maneuvers)? Should the slow-class window widen further for far-back entries with intermittent sources?
2. Verify on the installed server version: WS `PUT resources.logentries.*` routing to the provider's `setResource`, and delta emission for custom (non-standard) resource types — emission for standard types is documented in the server's AsyncAPI docs.

## Changes

Content changes only; formatting (e.g. re-wrapping) is not tracked.

- 2026-09-16: Initial draft — datetime-as-resource-id scheme with a uniform conflict rule and edit-as-move procedure, `POST` unsupported, tiered enrichment, permissions analysis, v1 deprecation plan.
- 2026-09-17: Revision after feedback from other logbook app maintainers:
  - Entry ids changed from datetimes to UUIDs: `POST` now supported, `setResource` is a standard create-or-replace upsert (conflict rule and move procedure removed), same-millisecond entries allowed, references stable across datetime corrections.
  - Added trip identifiers: `tripId` opened when the vessel gets under way and closed by `end: true` (any write surface), carried via enrichment.
  - Added a one-time storage migration backfilling `id` and `tripId` for pre-existing entries (segments delimited by `end: true`, >24 h gaps also split).
  - Enrichment: per-path history tolerances (fast: ±5 s, medium: ±60 s, slow: ±10 min) replace the single ±60 s window; a value outside its path's tolerance leaves the field blank rather than filled from stale data.
  - Enrichment: `enrich: false` named as the bulk path — history-tier lookups serialize behind the per-date write queue, so backfilling importers that carry complete data skip them.
  - Storage: the YAML day files are demoted to plugin storage/backup — the resource representation (API export in SI, open schema, `id`/`tripId`) is the interchange format, since capture-time display rounding makes the files thin for other importers.
  - Derived: `id`/`tripId` schema fields and example updates, `trip` listing filter, ordering by `datetime` with id tie-break, in-memory `id → date` storage index, v1 duplicate-datetime first-match rule, provider upsert/concurrency/error updates, storage gains `id`/`tripId`, new Open questions on trip detection, migration gap-splitting, and a possible trips resource.
  - Listing: the silent default 7-day window is removed — a listing must carry `date`, `from`/`to`, or `limit` (400 otherwise), so every response is complete by construction; `limit` clarified as selecting the newest N matches before the ascending ordering; added the `dates=true` day-calendar summary param (directory scan, non-normative), resolving an open question.
  - Schema: `waypoint` keeps bare coordinates (the enrichment source, `navigation.course.nextPoint`, has no resource id) and gains an optional `id` referencing `resources/waypoints`, resolving an open question.
- 2026-09-19: Revision after external review (`ricard-comments.md`, stylus-input logbook app):
  - `end: true` is strictly **trip end, never day end** — UTC days are a storage partition, not a logbook semantic, and the vessel is usually in another timezone. Trips are explicitly **anchor-to-anchor** (berth-to-berth): anchoring is a trip end by design, so the existing `Anchored`/`Stopped` triggers close trips as intended; a lunch anchoring closing a trip is accepted semantics, not a split leg.
  - Trips: an under-way transition while a trip is open *continues* the trip — a fresh UUID opens only when no trip is open (missed `end` markers join legs instead of splitting voyages).
  - New **Audit trail** section: `author` is attribution (delegation supported, defaults to the authenticated user on v1 routes), `timestamp` is now set on every write; revision history, soft-delete, principal-stamping, and signing are out of scope — providers cannot see the writing principal through the resources API (new open questions).
  - Storage: **new captures store full precision** — capture-time display rounding dropped for new writes, historical files untouched (resolves open question 6); the interchange round trip is lossless for new data.
  - Robustness: cross-day moves are write-new-then-delete-old with startup id-deduplication (a crash between steps loses nothing); the migration backs up day files before rewriting, with a downgrade note; history-tier enrichment lookups moved outside the per-date write queue so a slow History API never delays other writers.
  - Interop: `x-<app>-…` namespacing recommendation for extension fields; generic clients' param-less listings called out as an intentional 400; attachments covered by extension fields meanwhile (standard shape a new open question); single-provider-per-type documented (a second `logbook` registration fails).
  - Summary now states the reference-implementation/testbed intention explicitly.
- 2026-09-20: Split the document into two parts: **Part 1 — Specification** (identity, entry schema, trip semantics, audit trail, listing, access patterns, permissions, provider requirements, interchange format) and **Part 2 — Implementation plan** for signalk-logbook. All automations — auto-entry triggers, trip tracking, tiered enrichment, the `origin` write default — moved to Part 2, joined by storage, migration, v1 compatibility, access-level changes, and the step-by-step plan; the `author` defaulting rule stays in the spec (Part 1, Audit trail). Open questions split accordingly (renumbered). Part 1 wording made provider-neutral; content otherwise unchanged.
- 2026-09-21: Revision after feedback — telemetry follows normal Signal K paths, not just their units:
  - Snapshot fields became flat, dotted Signal K paths — `navigation.headingTrue`, `navigation.speedOverGround`, `environment.outside.pressure`, `propulsion.<instance>.runTime` — replacing the entry-local names (`heading`, `speed: {sog, stw}`, `barometer`, `engine.engines`, …); values keep SK SI units and the specification's value shapes, so entries read and write the same paths deltas and the History API use.
  - `waypoint` became `navigation.course.nextPoint` in the server Course API's shape, with `href` (not `id`) referencing `resources/waypoints`; `crewNames`, `skipperName`, and `vhf` became `communication.crewNames`, `communication.skipperName`, and `communication.vhf.channel` — so every vessel-state snapshot field, telemetry or not, carries its Signal K path, and only the logbook's own fields keep short names.
  - Weather observations gained `environment` paths as upstream candidates: `environment.water.seaState` (WMO 0–9), `environment.outside.cloudCoverage` (oktas 0–8), `environment.outside.visibility` (0–9) — human-observation codes, deliberately distinct from the instrument meteo paths of specification#662.
  - Derived updates: enrichment tolerance classes renamed to paths, engine normalization described as flat `propulsion.*.runTime` keys, storage explicitly unchanged in field names (translation happens at the resources boundary), smoketest updates, a new open question on visibility coding (the field-name-boundary question was resolved by the `communication.*` move and removed), and correction of a reference to the nonexistent `navigation.speedOverGroundTrue` path.
- 2026-09-24: Telemetry moved from top-level dotted-path fields to a `telemetry` array of flattened delta pathvalues:
  - Each array item is `{path, value, $source?}` — the same shape delta updates and History API responses use for individual values; the field table split into entry fields and telemetry paths, and the JSON example was reshaped. The `communication.*` paths (`vhf.channel`, `crewNames`, `skipperName`) moved into the array too, leaving only the logbook's own fields at the top level — the split rule is now simply "Signal K paths live in telemetry".
  - The array (not an object) allows the same path more than once, each item with its own `$source` sourceRef — multiple simultaneous values for a path per the server's Multiple Values logic; the recommended core set stays, and any other Signal K path may ride along (open content model extended to unknown telemetry paths and extra pathvalue members, namespaced via Signal K's `proprietary.*` convention).
  - A pathvalue's `$source`/`timestamp` are data about where and when the value was sampled, preserved verbatim — distinct from the entry-level provider `$source` and provider-set `timestamp`, both stripped on write.
- 2026-09-24: Observation paths aligned with existing ecosystem paths; `tripId` removed:
  - Weather observations ride existing (or actively proposed) paths and scales instead of new near-duplicates: `environment.water.seaState` carries **Beaufort** — the scale of the server Weather API's `water.seaState` (the draft's WMO/Douglas 0–9 was same name, different scale); `environment.outside.cloudCover` carries specification#662's **ratio 0–1** (oktas convert exactly, n oktas = n/8, so the separate `cloudCoverage` path disappears); only `environment.outside.visibility` (0–9 descriptive code) remains a new path to propose upstream.
  - `tripId` removed entirely — trip grouping is deferred to a separate, later **Trips Resource** spec that scopes trips by start/end timestamps. Entries keep the `end: true` voyage-end marker (anchor-to-anchor, trip end never day end). Derived removals: the `trip` listing filter, the trip-tracking and trip-tagging automations, `tripId` in schema/example/storage/migration (no more segment replay or >24 h gap splitting), and the trips-related open questions (resolved by deferral).
  - Storage: the sea-state boundary translation noted — Douglas (storage, legacy `swell.state` source, UI picker) ↔ Beaufort (API) via the standard WMO correspondence, the one non-exact conversion.
  - Derived: `bbox` and engine normalization reworded to pathvalues, enrichment described as filling missing paths (never duplicating a present one, per-path partial fills), smoketests updated (duplicate-path preservation, unknown-path preservation, per-path partial fills).
- 2026-09-28: Revision after further review comments:
  - The resource type is renamed `logbook` → **`logentries`** (maintainer feedback, insisted upon): a resource type names its instances — `resources/routes/<id>` is one route — and each resource here is a single log entry, not a logbook; the logbook is the collection the entries compose. A side benefit: the type name stays clear of the `logbook` feature id already reserved in the server's `SignalKApiId` enum. Derived renames throughout: API routes, websocket topics, provider registration, access-pattern examples, permissions table, the v1 deprecation pointers, and the upstream-proposal wording.
  - Trips: review's generic-grouping alternative recorded — an opaque `groupId`/`groupIds` entry field with a `group` listing filter would let apps manage any grouping (trips, legs, rallies, maintenance campaigns) on top of time-based retrieval, instead of a dedicated Trips Resource. Deferred: backward-compatible to add later, with namespaced extension fields covering prototyping meanwhile; raised as a new Part 1 open question.
- 2026-10-03: Implementation and upstream status:
  - **Steps 1–6 implemented** in this repo: id migration and index in storage, the `logentries` resource provider (filtering, upsert semantics, tiered enrichment, defaults), the entry schema published at `schema/logentries.schema.json`, the full smoketest suite, the webapp migrated to the resources API (edits are PUTs on the entry id; telemetry renders through the user's Signal K unit preferences with a nautical fallback, from the entry's original SI telemetry — write-back is rebuilt from that telemetry plus form edits, so neither display conversion nor editing touches stored precision), and the v1 `/logs` routes deprecated (Deprecation/Link headers, debug logging, `router.access` alignment, OpenAPI flags).
  - **Storage snap**: unit conversion at the storage boundary snaps values so the write → read → write round trip is stable (exact when a nautical preimage of the SI value exists, within a few ulps otherwise). The Interchange format wording's "reads return exactly what was written" holds verbatim for verbatim-carried fields (position, visibility, observations on the descriptive scale) and within float noise for scale-converted numerics.
  - **Upstream adoption under way in signalk-server**: `logentries` added to the server's standard resource types (OpenAPI/AsyncAPI definitions, typebox `LogEntrySchema`, WS and v1-path `PUT resources.logentries.<id>` routing through the Resources API, listing-window validation server-side), with the generic file-storage provider's `logentries` support explicitly opt-in (default off) since log entries belong to a logbook plugin. Verified compatible with and without that server work: the plugin registers the type as a custom type on older servers, where only the HTTP status mapping of provider errors (server wraps rejections in its generic 404s) and the AsyncAPI-documented delta topic differ. A spec-level proposal to SignalK/specification remains optional and decoupled.
- 2026-10-03: Revision after further review feedback:
  - `end: true` dropped from the standard schema: with trips as intervals in their own (upcoming) Trips Resource, the entry-level marker stored a trip boundary a second time — once on the entry, once as the Trips Resource's end timestamp — and went stale when the boundary moved afterwards (a corrected entry datetime, an edited trip end). Trip boundaries belong to the Trips Resource alone; the stop itself is expressible as telemetry (`navigation.state` anchored/moored). The reference implementation keeps writing its legacy `end` marker via the `Anchored`/`Stopped` triggers — preserved as an unknown field by the open content model — and reads those legacy markers when building trips (Part 2, Auto-entry triggers). Derived: summary, goals, field table, Trips section, and schema updates.
  - Sea state moved to the ecosystem's label/value pair: nmea0183-signalk writes AIS meteo sea state as a string label on `environment.water.seaState` with the numeric Beaufort code on `environment.water.seaStateValue` (VDM.ts), so a number on `seaState` conflicted with that convention. The logbook's Beaufort estimate now rides `seaStateValue`, and reads emit the matching WMO state-of-sea label (`slight`, `moderate`, `rough`, …) on `seaState` — the same words the UI renders for the numbers. Storage (Douglas codes) and the Douglas↔Beaufort correspondence are unchanged. Derived: provider telemetry translation, enrichment capture path, live-state subscription path, UI editable-path list, schema and OpenAPI description updates, example and smoketest updates.
- 2026-10-04: Revision after further review feedback (SignalK/signalk-server#3115):
  - The `environment.water.seaState` label pathvalue is dropped from the resource representation; the estimate rides `environment.water.seaStateValue` (Beaufort 0–12) alone. The label vocabulary is defined nowhere — neither the specification nor the server — and nmea0183-signalk writes Beaufort wind descriptions ("gentle breeze, 3.4-5.4 m/s") on that path, where IMO SN.1/Circ.289 Table 1.2 describes the sea; emitting WMO state-of-sea labels alongside would put a second, undefined vocabulary on the same path. Consumers wanting words map the numeric code through the WMO Douglas↔Beaufort correspondence themselves. Storage (Douglas codes) and the Douglas↔Beaufort correspondence are unchanged, as is the UI's own label rendering from the stored code. Derived: provider telemetry translation (label mapping removed), UI editable-path list, schema description, field table, Weather observation paths, example, storage wording, and smoketest updates.
- 2026-10-03: Fixes for meri-imperiumi/signalk-logbook#105 (writes that drop or alter entry data):
  - Out-of-range telemetry no longer rejects the whole entry. The storage schema has ranges the standard schema does not; a known path whose value has no representable storage form (heading outside 0–2π, negative speed/log/engine time, position outside WGS84 bounds, visibility above 9, a VHF channel beyond three characters) now parks verbatim in the entry's `telemetry` array exactly like an unknown path — including values inserted by enrichment — so the write keeps the entry and reads return the pathvalue as sent. Previously only sea state and cloud cover parked; every other ranged field rejected the write, text included.
  - Replace is now consistently *omitted means preserved*: `origin`, `author`, and `telemetry` omitted on a replace keep their stored values (previously an API edit reset `origin` to the `agent` create default), and a supplied `telemetry` array — even empty — is taken as sent, so removing a captured path is one PUT instead of being silently refilled by enrichment. Enrichment is now a create-time convenience: a replace only enriches when it explicitly carries `enrich: true`. Derived: provider setResource rework, spec Provider-requirements/Enrichment/Write-defaults wording, smoketest updates.
- 2026-10-03: Internal writes emit `resources.logentries` deltas (meri-imperiumi/signalk-logbook#106): triggers, hourly entries, notification entries, and the deprecated v1 routes write straight to storage, and the server only deltifies writes routed through the resource provider — so a client subscribed to `resources.logentries` saw none of the automatic entries and had to poll. `Log` now resolves its legacy write methods with the stored (or removed) entry and a change listener emits the delta per the server's resource provider docs (resource representation as value, `null` on delete, version 2), gated on the provider being registered and never failing the write; provider writes never pass the listener, since the server emits those itself. Derived: new plugin/deltas.js, Log change-listener hook and write resolutions, wiring in plugin/index.js, new Part 2 section, smoketests.