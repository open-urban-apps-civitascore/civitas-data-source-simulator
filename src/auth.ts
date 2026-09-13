import type { NextFunction, Request, RequestHandler, Response } from "express";
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";

/**
 * Bearer verification against the instance's Keycloak, matching what the
 * platform's own backend does: the token is checked here, rather than trusting
 * a header a gateway claims to have set.
 *
 * Deliberately fails closed. Starting without an issuer is an error, not an
 * open door, because the failure it guards against is a deployment that
 * accepts every caller since someone forgot one variable. Turning checking off
 * has to be said out loud.
 */

export interface AuthConfig {
  issuer: string;
  requiredRole?: string;
  audience?: string;
}

export const ISSUER_VAR = "AUTH_ISSUER_URL";
export const REQUIRED_ROLE_VAR = "AUTH_REQUIRED_ROLE";
export const AUDIENCE_VAR = "AUTH_AUDIENCE";
export const DISABLED_VAR = "SIMULATOR_AUTH_DISABLED";

/** Null means checking is off, and only an explicit variable can say so. */
export function readAuthConfig(
  env: Record<string, string | undefined> = process.env,
): AuthConfig | null {
  if (env[DISABLED_VAR]?.trim() === "1") return null;

  const issuer = env[ISSUER_VAR]?.trim();
  if (!issuer) {
    throw new Error(
      `No token issuer configured: set ${ISSUER_VAR} to the realm URL, or ${DISABLED_VAR}=1 to run without authentication.`,
    );
  }
  return {
    issuer,
    requiredRole: env[REQUIRED_ROLE_VAR]?.trim() || undefined,
    audience: env[AUDIENCE_VAR]?.trim() || undefined,
  };
}

/** Realm roles and client roles alike, as Keycloak nests them in a token. */
export function rolesOf(claims: Record<string, unknown>): string[] {
  const roles: string[] = [];
  const take = (value: unknown) => {
    if (!isObject(value)) return;
    const list = (value as { roles?: unknown }).roles;
    if (Array.isArray(list)) {
      for (const role of list) if (typeof role === "string") roles.push(role);
    }
  };

  take(claims.realm_access);
  if (isObject(claims.resource_access)) {
    for (const perClient of Object.values(claims.resource_access)) take(perClient);
  }
  return roles;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Throws when a token is valid but not permitted to change simulations. */
export function assertClaims(claims: Record<string, unknown>, config: AuthConfig): void {
  if (!config.requiredRole) return;
  if (rolesOf(claims).includes(config.requiredRole)) return;
  throw new Error(`The token lacks the role '${config.requiredRole}'.`);
}

/** Liveness answers before anyone is authenticated: probes carry no token. */
const OPEN_PATHS = new Set(["/healthz"]);

export function createAuthMiddleware(
  config: AuthConfig | null,
  /** Injectable so the middleware can be tested without a network. */
  keySet?: JWTVerifyGetKey,
): RequestHandler {
  const keys =
    config && !keySet
      ? createRemoteJWKSet(new URL(`${config.issuer}/protocol/openid-connect/certs`))
      : keySet;

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!config) {
      next();
      return;
    }
    if (OPEN_PATHS.has(req.path)) {
      next();
      return;
    }

    const [scheme, token] = (req.header("authorization") ?? "").split(" ");
    if (scheme?.toLowerCase() !== "bearer" || !token) {
      res.status(401).json({ error: "Missing bearer token." });
      return;
    }

    try {
      const { payload } = await jwtVerify(token, keys!, {
        issuer: config.issuer,
        ...(config.audience ? { audience: config.audience } : {}),
      });
      assertClaims(payload as Record<string, unknown>, config);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // A valid token without the role is a different answer from a token we
      // will not accept at all: one is worth telling an administrator about.
      const forbidden = message.includes("lacks the role");
      res.status(forbidden ? 403 : 401).json({ error: message });
      return;
    }
    next();
  };
}
