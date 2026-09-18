# Deploying the simulator as an add-on

This folder is the CIVITAS component for the demo data simulator. It follows
the same shape as the platform's own components, so it installs by copying the
folder into the deployment repository's `components/` and adding one line to
the component list. Nothing central is edited.

## What it deploys

One chart, four workloads, under the release `demo-data-generator-simulator`.

| Workload | Reachable from | Purpose |
| --- | --- | --- |
| `…-api` | inside the cluster only | The control API: what to simulate |
| `…-ui` | the browser, via an APISIX route | The web interface |
| `…-broker` | inside the cluster only | Where MQTT simulations publish |
| `…-db` | inside the cluster only | Where SQL simulations write rows |

The broker and the database are switchable. A municipality already running
either should switch ours off and point the use case's datasource at theirs;
the payloads are identical, so nothing else changes.

The control API is deliberately **not** routed. The interface's own server
calls it inside the cluster, so exposing it would put an API that changes what
gets published on the public internet for no gain.

## Before installing

Three secrets must exist in the component's namespace. The deployment pipeline
creates them; none may be committed here.

| Secret | Key | Holds |
| --- | --- | --- |
| `keycloak-client-demo-data-generator` | `client-secret` | The interface's Keycloak client secret |
| `demo-data-generator-nextauth-secret` | `secret` | Session-cookie encryption for the interface |
| `demo-data-generator-db` | `password` | The database password |

A Keycloak client `demo-data-generator` must exist in the realm, with the
interface's public URL among its redirect addresses. The local definition is
versioned in `../docs/keycloak/`.

## Authentication

The control API verifies a Keycloak token on every request and **refuses to
start** unless it is told which realm to trust, so a forgotten value fails
loudly instead of leaving the API open. `generator.auth.requiredRole`
additionally demands a role, once one exists in the realm.

`generator.auth.disabled` exists as an emergency switch and turns every check
off. The chart says so in its install notes when it is used.

## Images

Two, both built from this repository:

- `civitas-demo-data-generator` from `../Dockerfile` (the control API)
- `civitas-demo-data-generator-ui` from `../ui/Dockerfile` (the web interface)

## Once it is running

The marketplace enables its simulator features when it has an address for the
control API. Set `simulator.apiUrl` on the marketplace release to this
component's API service, and `simulator.brokerUrl` only if the simulator and
the broker are not in the same network, which in a cluster they are.
