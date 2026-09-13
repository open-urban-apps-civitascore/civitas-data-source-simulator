import { SignJWT, exportJWK, generateKeyPair, createLocalJWKSet, type JSONWebKeySet } from "jose";
import { describe, expect, it } from "vitest";

import { assertClaims, createAuthMiddleware, readAuthConfig, rolesOf, type AuthConfig } from "./auth.js";

const ISSUER = "https://keycloak.example/realms/civitas-core";

describe("readAuthConfig", () => {
  it("refuses to start without an issuer", () => {
    // The failure mode this prevents is a deployment that silently accepts
    // every caller because someone forgot one environment variable.
    expect(() => readAuthConfig({})).toThrow(/No token issuer configured/);
  });

  it("reports that checking is off only when asked explicitly", () => {
    expect(readAuthConfig({ SIMULATOR_AUTH_DISABLED: "1" })).toBeNull();
  });

  it("reads the issuer and the optional role", () => {
    expect(readAuthConfig({ AUTH_ISSUER_URL: ISSUER, AUTH_REQUIRED_ROLE: "simulator" })).toEqual({
      issuer: ISSUER,
      requiredRole: "simulator",
      audience: undefined,
    });
  });
});

describe("rolesOf", () => {
  it("sees realm roles and client roles alike", () => {
    const roles = rolesOf({
      realm_access: { roles: ["offline_access"] },
      resource_access: { marketplace: { roles: ["simulator"] } },
    });
    expect(roles).toEqual(["offline_access", "simulator"]);
  });

  it("copes with a token carrying neither", () => {
    expect(rolesOf({ sub: "someone" })).toEqual([]);
  });
});

describe("assertClaims", () => {
  const config: AuthConfig = { issuer: ISSUER, requiredRole: "simulator" };

  it("rejects a valid token that lacks the role", () => {
    expect(() => assertClaims({ sub: "a" }, config)).toThrow(/lacks the role/);
  });

  it("accepts one that has it", () => {
    expect(() =>
      assertClaims({ sub: "a", realm_access: { roles: ["simulator"] } }, config),
    ).not.toThrow();
  });
});

/** Minimal Express stand-ins, so the middleware can be exercised directly. */
function call(middleware: ReturnType<typeof createAuthMiddleware>, authorization?: string, path = "/simulations") {
  return new Promise<{ status: number; body: unknown; passed: boolean }>((resolve) => {
    let status = 200;
    const res = {
      status(code: number) {
        status = code;
        return this;
      },
      json(body: unknown) {
        resolve({ status, body, passed: false });
      },
    };
    const req = { path, header: () => authorization };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    void middleware(req as any, res as any, () => resolve({ status: 200, body: null, passed: true }));
  });
}

describe("createAuthMiddleware", () => {
  it("lets everything through when checking is off", async () => {
    expect((await call(createAuthMiddleware(null))).passed).toBe(true);
  });

  it("answers liveness before anyone is authenticated", async () => {
    const middleware = createAuthMiddleware({ issuer: ISSUER }, async () => {
      throw new Error("should not be consulted");
    });
    expect((await call(middleware, undefined, "/healthz")).passed).toBe(true);
  });

  it("refuses a request with no token", async () => {
    const middleware = createAuthMiddleware({ issuer: ISSUER }, async () => {
      throw new Error("should not be consulted");
    });
    const result = await call(middleware);
    expect(result.status).toBe(401);
    expect(result.passed).toBe(false);
  });

  it("accepts a properly signed token and rejects one signed by someone else", async () => {
    const ours = await generateKeyPair("RS256");
    const theirs = await generateKeyPair("RS256");
    const jwks: JSONWebKeySet = { keys: [{ ...(await exportJWK(ours.publicKey)), alg: "RS256" }] };
    const middleware = createAuthMiddleware({ issuer: ISSUER }, createLocalJWKSet(jwks));

    const sign = async (key: CryptoKey) =>
      new SignJWT({ realm_access: { roles: ["simulator"] } })
        .setProtectedHeader({ alg: "RS256" })
        .setIssuer(ISSUER)
        .setSubject("someone")
        .setExpirationTime("5m")
        .sign(key);

    expect((await call(middleware, `Bearer ${await sign(ours.privateKey)}`)).passed).toBe(true);
    expect((await call(middleware, `Bearer ${await sign(theirs.privateKey)}`)).status).toBe(401);
  });

  it("rejects an expired token", async () => {
    const ours = await generateKeyPair("RS256");
    const jwks: JSONWebKeySet = { keys: [{ ...(await exportJWK(ours.publicKey)), alg: "RS256" }] };
    const middleware = createAuthMiddleware({ issuer: ISSUER }, createLocalJWKSet(jwks));

    const expired = await new SignJWT({})
      .setProtectedHeader({ alg: "RS256" })
      .setIssuer(ISSUER)
      .setSubject("someone")
      .setExpirationTime(Math.floor(Date.now() / 1000) - 60)
      .sign(ours.privateKey);

    expect((await call(middleware, `Bearer ${expired}`)).status).toBe(401);
  });
});
