# Keycloak client for the simulator UI

The UI signs users in against the CIVITAS/CORE instance's own Keycloak. The client lives in the realm `civitas-core`.

`demo-data-generator-client.local.json` is the **local dev** definition. It is
versioned so the client can be recreated after a Keycloak volume reset, which
deletes everything not in the realm export.

Register it (local stack, Keycloak on :8080, admin/admin):

```bash
TOKEN=$(curl -s -X POST http://localhost:8080/realms/master/protocol/openid-connect/token \
  -d 'client_id=admin-cli' -d 'username=admin' -d 'password=admin' -d 'grant_type=password' \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["access_token"])')

curl -s -X POST http://localhost:8080/admin/realms/civitas-core/clients \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  --data-binary @docs/keycloak/demo-data-generator-client.local.json
```

Then put the same secret into `ui/.env.local` as `AUTH_KEYCLOAK_SECRET`.

The secret here is a dev-only placeholder and must not be used anywhere else.
