# CIVITAS demo data generator

Publishes believable fake sensor data so a freshly installed use case shows something
instead of an empty screen.

**Status:** proof of concept. The service works end to end against a broker; it is not
yet wired to the marketplace and not yet packaged for deployment.

## The one design rule

The generator emits **the use case's own data format**, exactly as a real device would:

```json
{ "counterId": "counter-001", "timestamp": "2026-07-31T12:58:51.343Z",
  "vehicleCount": 138, "avgSpeedKmh": 29.5, "direction": "inbound",
  "location": { "lat": 49.79, "lon": 9.93 } }
```

It does **not** emit SensorThings. Translating a device's format into SensorThings is
the pipeline's job (a `mapping` node), not the generator's. Keeping that boundary is
what makes a real sensor a drop-in replacement: point the device at the same topic and
delete the simulation — nothing else changes.

Consequence worth knowing: a pipeline **without** a mapping node runs in passthrough
mode and only accepts SensorThings, so it will ignore these messages. Mapped mode has
not been verified live yet — see `open-urban-apps-meta-planning/docs/exploration/
2026-07-28-demo-data-simulator-design.md`.

## Run

Start the broker, then the generator:

```bash
docker compose up -d
corepack pnpm install
corepack pnpm dev
```

The generator listens on `:4300` (`PORT` to change it). The broker listens on
`localhost:1884` from your machine, and on `civitas-mosquitto:1883` from inside the
platform network — which is the address the marketplace writes into a demo install's
datasource, so NiFi finds it without any extra configuration.

## The broker

This repo ships a stock Mosquitto (`broker/mosquitto.conf` — configuration only, no
code). It runs as its own container rather than inside the Node process, because NiFi
holds a long-lived subscription to it: sharing a process would drop that subscription
on every generator restart, and "is my data flowing?" would be ambiguous after every
code change.

It is a **simulation-only** broker. We are not offering municipalities messaging
infrastructure for real sensors — they have their own, and its security, retention
and availability are not ours to own. Going live means repointing the datasource at
their broker; because the payload shape is identical, nothing else changes.

The dev stack must be up first, since the broker joins its `civitas-network`.

> Replaces `appstore-addon/demo-broker/docker-compose.yml`. Both use the container
> name `civitas-mosquitto`, so stop the old one before starting this:
> `docker compose -f ../appstore-addon/demo-broker/docker-compose.yml down`

## API

| Method | Path | Purpose |
| --- | --- | --- |
| `PUT` | `/simulations/{id}` | Create or replace. Caller owns the id — the marketplace passes its dataset id |
| `GET` | `/simulations` | List, for reconciliation after a restart |
| `GET` | `/simulations/{id}` | Status, including `publishedCount` and `lastPayload` |
| `DELETE` | `/simulations/{id}` | Stop and forget |
| `POST` | `/simulations/{id}/switch_on` · `/switch_off` | Pause and resume without losing the scenario |
| `GET` | `/simulations/{id}/sample?count=5` | Render without publishing |
| `POST` | `/sample` | Render an unregistered scenario — powers a catalogue preview |
| `GET` | `/healthz` | Liveness |

### Registering a simulation

```bash
curl -X PUT http://localhost:4300/simulations/my-dataset-id \
  -H 'Content-Type: application/json' \
  -d '{
    "transport": { "kind": "mqtt", "url": "mqtt://localhost:1884",
                   "topic": "civitas/musterhausen-trafficcounter" },
    "scenario": {
      "intervalSeconds": 10,
      "fields": {
        "counterId":    { "kind": "constant", "value": "counter-001" },
        "timestamp":    { "kind": "now" },
        "vehicleCount": { "kind": "dailyProfile", "min": 2, "max": 180,
                          "peakHours": [8, 17], "integer": true },
        "avgSpeedKmh":  { "kind": "randomWalk", "min": 5, "max": 60, "step": 3, "start": 30 },
        "direction":    { "kind": "enum", "values": ["inbound", "outbound"] },
        "location.lat": { "kind": "constant", "value": 49.79 },
        "location.lon": { "kind": "constant", "value": 9.93 }
      }
    }
  }'
```

Field keys are dotted paths, so nested payloads need no extra syntax.

### Generators

| Kind | Produces |
| --- | --- |
| `constant` | A fixed value |
| `now` | Current time, ISO-8601 |
| `enum` | One of `values`, at random |
| `randomWalk` | Drifts within `[min, max]`, at most `step` per tick. Stateful, so readings look related |
| `dailyProfile` | Follows the clock — low at night, peaking at `peakHours`. This is what makes data look real |

## Design decisions

**Stateless.** Simulations live in memory only. The marketplace already holds the
install records, so persisting them here would be a second copy of the same truth, and
two copies eventually disagree. After a restart this service is empty and the
marketplace re-registers.

**`PUT` with a caller-supplied id.** Uninstall can `DELETE /simulations/{datasetId}`
with no lookup table, and a retry converges instead of starting a second publisher.

**A unique MQTT client id per simulation.** NiFi's own consumer uses a fixed client id
and its flows visibly kick each other off the broker with "session taken over". Two
publishers sharing an id would do the same, and the symptom — messages silently
stopping — is miserable to debug.

**Capped at 50 simulations.** A demo tool must not be able to flood a municipal broker.

## Not done yet

- Marketplace wiring (register on AVAILABLE, unregister on uninstall)
- Deployment packaging (`civitas-component.yaml`, Helm chart, Dockerfile) — one chart
  with two Deployments, the broker gated on a values flag so an operator who already
  has a broker can switch ours off
- Authz on the control API — required before this ships to municipalities
- Marking generated data as simulated, so it can never be mistaken for real
  measurements on an open-data API
- Verifying mapped mode live, which is what makes these payloads ingestible

## Funding

This project is funded by the **Federal Ministry of Research, Technology and Space (BMFTR)** as part of the **[Prototype Fund](https://prototypefund.de/)**, an initiative by the Open Knowledge Foundation Germany. 

<div style="display: flex; gap: 20px; align-items: center; margin-top: 20px;">
  <a href="https://www.bmbf.de/" target="_blank"><img src="./logo/bmftr.svg" height="110" alt="BMFTR Logo" /></a>
  <a href="https://prototypefund.de/" target="_blank"><img src="./logo/ptf.svg" height="110" alt="Prototype Fund Logo" /></a>
</div>
