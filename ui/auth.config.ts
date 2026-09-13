import type { NextAuthConfig } from "next-auth";

import { isTokenExpired, refreshAccessToken } from "@/lib/token-utils";

// The simulator, the marketplace and the portal all run on `localhost` in dev.
// Browser cookies are scoped by HOSTNAME, not port, so with the default names
// the apps overwrite each other's auth cookies — and since each has its own
// secret, none can decrypt another's, throwing every session out.
const COOKIE_PREFIX = "simulator";
const useSecureCookies = process.env.NODE_ENV === "production";
const cookieName = (name: string) =>
  `${useSecureCookies ? "__Secure-" : ""}${COOKIE_PREFIX}.${name}`;

const baseCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  path: "/",
  secure: useSecureCookies,
};

/** The session cookie's name, for `getToken()` which looks it up by name. */
export const sessionCookieName = (secure: boolean) =>
  `${secure ? "__Secure-" : ""}${COOKIE_PREFIX}.session-token`;

export const authConfig = {
  session: { strategy: "jwt", maxAge: 10 * 60 * 60 },
  pages: { signIn: "/login" },
  cookies: {
    sessionToken: { name: cookieName("session-token"), options: baseCookieOptions },
    callbackUrl: { name: cookieName("callback-url"), options: baseCookieOptions },
    csrfToken: {
      name: `${useSecureCookies ? "__Host-" : ""}${COOKIE_PREFIX}.csrf-token`,
      options: baseCookieOptions,
    },
    pkceCodeVerifier: {
      name: cookieName("pkce.code_verifier"),
      options: { ...baseCookieOptions, maxAge: 60 * 15 },
    },
    state: { name: cookieName("state"), options: { ...baseCookieOptions, maxAge: 60 * 15 } },
    nonce: { name: cookieName("nonce"), options: baseCookieOptions },
  },
  callbacks: {
    async jwt({ token, account }) {
      if (account) {
        // First sign-in: the Keycloak tokens move into the session cookie,
        // which is encrypted with NEXTAUTH_SECRET.
        return {
          ...token,
          access_token: account.access_token,
          expires_at: account.expires_at,
          refresh_token: account.refresh_token,
          id_token: account.id_token,
        };
      }
      if (!isTokenExpired(token.expires_at as number | undefined)) return token;

      const refreshed = await refreshAccessToken(token);
      // Returning null is what makes Auth.js drop the session cookie, chunks
      // and secure attributes included. An unreachable Keycloak keeps the
      // token so the next request can retry.
      if (refreshed.error === "RefreshTokenExpired") return null;
      return refreshed;
    },
    session({ session, token }) {
      // Only the error travels to the browser. Tokens stay in the encrypted
      // cookie: anything placed on the session is served by /api/auth/session,
      // which any script on the page can read.
      return { ...session, error: token.error };
    },
  },
  events: {
    // End the Keycloak session too, not just the local cookie.
    async signOut(message) {
      if ("token" in message && message.token?.id_token) {
        const params = new URLSearchParams({ id_token_hint: message.token.id_token as string });
        await fetch(
          `${process.env.KEYCLOAK_ISSUER}/protocol/openid-connect/logout?${params}`,
        ).catch(() => undefined);
      }
    },
  },
  providers: [],
} satisfies NextAuthConfig;
