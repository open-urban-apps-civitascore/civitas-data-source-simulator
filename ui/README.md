# Simulator UI

The add-on's own web interface, so the simulator can be used outside the
marketplace — for example while building a use case of your own.

A Next.js app that talks to the generator's control API. The browser never
calls the generator directly: every request goes through this app's own `/api`
routes, so the service address stays server-side and there is one place to
attach a token once the control API checks authz.

## Run

The generator must be running first (`corepack pnpm dev` in the parent folder,
listening on :4300).

```bash
cp .env.example .env.local   # then fill in AUTH_SECRET and the Keycloak secret
corepack pnpm install
corepack pnpm dev
```

Then <http://localhost:3003>.

`SIMULATOR_SKIP_AUTH=1` starts it without a sign-in wall, for UI work with no
Keycloak at hand. Never set it anywhere a municipality can reach.

## Sign-in

Keycloak via next-auth, following the marketplace's setup file for file: the
config lives in `auth.config.ts` with the provider in `auth.ts`, auth cookies are
namespaced `simulator.*` (the marketplace, the add-on and this app all run on
`localhost`, and cookies are scoped by hostname, not by port), and the Keycloak
session is ended on sign-out, not just the local cookie.

Three things follow from that pattern and are worth knowing:

- **Tokens never reach the browser.** They live in the encrypted session cookie.
  The session object carries only an error field, because anything put on it is
  served by `/api/auth/session`, which any script on the page can read.
- **Access tokens are refreshed automatically.** They last about five minutes.
  An expired one is exchanged using the refresh token; a refresh token Keycloak
  refuses drops the session, while an unreachable Keycloak keeps it for a retry.
- **Each page checks the session itself.** The layout cannot do it on their
  behalf: layouts are cached on the client and do not re-render when navigating
  between routes that share them, so a guard there would not run again after the
  first load.

Server-side calls to the simulator carry the signed-in person's access token, so
the simulator sees who is acting. The client definition is versioned in
`../docs/keycloak/`, so it can be recreated after a Keycloak volume reset.

## Screens

| Page | Path | What it does |
| --- | --- | --- |
| Simulationen | `/simulations` | Every registered simulation with an on/off switch, type, target, interval, status, counter and last event. Polls, so the counters move. |
| Detail | `/simulations/{id}` | Overview, on/off, the data structure per field, and a live stream of events. `?view=json` opens the expert view of the API body. |
| Anlegen / Bearbeiten | `/simulations/new`, `/simulations/{id}/edit` | Name, target (broker and topic, or database table), interval, and a generator per field. The preview is rendered by the generator itself. `?mode=json` edits the API body directly. |
| Datenstrukturen | `/datastructures` | Data structures of the instance, each with a button that pre-fills the editor. |
| Was ist das? | `/docs` | Short explanation and the seven generators. |

## Known gaps

- **The live stream polls.** The control API has no event channel, so a new
  event is a `lastPayload` whose timestamp moved since the last poll. A
  simulation whose interval is shorter than the poll drops events from the view;
  the counter stays complete and the UI says so. Server-Sent Events on the
  generator would close this.
- **The data structures are placeholders.** They are constants in
  `lib/portal-datastructures.ts`. They have to come from the portal-backend
  (Model Forge) with the signed-in user's token.
- **The marketplace has no token yet.** The simulator can now require one, but
  the marketplace still calls it without, so switching the check on in an
  instance that installs use cases would break installs until the marketplace
  gets a Keycloak service account.
- **Simulations do not survive a restart.** The registry is in memory by design,
  because the marketplace owns the install records. Used standalone, there is no
  such owner, so a restart empties the list.
