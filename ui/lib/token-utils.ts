import type { JWT } from "next-auth/jwt";

/** A minute of slack, so a token does not expire mid-request. */
export function isTokenExpired(expiresAt?: number): boolean {
  if (!expiresAt) return true;
  return Date.now() >= (expiresAt - 60) * 1000;
}

/**
 * Exchanges the refresh token for a fresh access token.
 *
 * The two failure modes are kept apart because the caller reacts differently.
 * `RefreshTokenExpired` means Keycloak refused the grant, so retrying can never
 * succeed and the session is discarded. `RefreshTokenError` means we got no
 * verdict (Keycloak unreachable), so the token is kept and the next request
 * tries again.
 */
export async function refreshAccessToken(token: JWT): Promise<JWT> {
  const issuer = process.env.KEYCLOAK_INTERNAL_ISSUER ?? process.env.KEYCLOAK_ISSUER;
  let response: Response;
  try {
    response = await fetch(`${issuer}/protocol/openid-connect/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.KEYCLOAK_CLIENT_ID ?? "",
        client_secret: process.env.KEYCLOAK_CLIENT_SECRET ?? "",
        grant_type: "refresh_token",
        refresh_token: token.refresh_token as string,
      }),
    });
  } catch {
    return { ...token, error: "RefreshTokenError" };
  }
  if (!response.ok) {
    const rejected = response.status >= 400 && response.status < 500;
    return { ...token, error: rejected ? "RefreshTokenExpired" : "RefreshTokenError" };
  }
  const fresh = (await response.json()) as {
    access_token: string;
    expires_in: number;
    refresh_token?: string;
  };
  return {
    ...token,
    access_token: fresh.access_token,
    expires_at: Math.floor(Date.now() / 1000) + fresh.expires_in,
    refresh_token: fresh.refresh_token ?? token.refresh_token,
    error: undefined,
  };
}
