import "server-only";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getToken } from "next-auth/jwt";

import { auth } from "@/auth";
import { sessionCookieName } from "@/auth.config";
import { isTokenExpired, refreshAccessToken } from "@/lib/token-utils";

/** Local UI work without a Keycloak at hand. Never set this anywhere shared. */
export function authDisabled(): boolean {
  return process.env.SIMULATOR_SKIP_AUTH === "1";
}

/**
 * Guard for authenticated pages. Every protected page calls this itself: the
 * surrounding layout cannot do it on their behalf, because layouts are cached
 * on the client and do not re-render when navigating between routes that share
 * them, so a check placed there would not run again after the first load.
 */
export async function requireSession() {
  if (authDisabled()) return null;
  const session = await auth();
  if (!session || session.error) redirect("/login");
  return session;
}

/** The signed-in user for display, or null. */
export async function currentUser() {
  if (authDisabled()) return null;
  const session = await auth();
  return session?.user ?? null;
}

/** True when a request may proceed. Used by the API routes, which answer 401. */
export async function isAuthorised(): Promise<boolean> {
  if (authDisabled()) return true;
  const session = await auth();
  return Boolean(session?.user) && !session?.error;
}

/**
 * The Keycloak access token for server-side calls to the simulator. It lives
 * only in the encrypted session cookie and is never exposed to the browser.
 *
 * Access tokens live about five minutes and Server Components cannot write
 * cookies, so a stored token will be stale for any session older than that.
 * Rather than failing, it is exchanged on the fly; the cookie stays stale,
 * which only means the exchange repeats per request.
 *
 * Null while auth is disabled, and null when Keycloak is not configured at all.
 */
export async function getAccessToken(): Promise<string | null> {
  if (authDisabled()) return null;

  const requestHeaders = await headers();
  const secureCookie = requestHeaders.get("x-forwarded-proto") === "https";
  const token = await getToken({
    req: { headers: requestHeaders },
    secret: process.env.NEXTAUTH_SECRET,
    secureCookie,
    // Must match the namespaced name from auth.config.ts — getToken looks the
    // cookie up by name and would otherwise find nothing.
    cookieName: sessionCookieName(secureCookie),
  });
  if (!token?.access_token) return null;

  if (isTokenExpired(token.expires_at as number | undefined)) {
    const refreshed = await refreshAccessToken(token);
    if (refreshed.error || !refreshed.access_token) return null;
    return refreshed.access_token as string;
  }
  return token.access_token as string;
}
