import NextAuth from "next-auth";
import Keycloak from "next-auth/providers/keycloak";

// Cookies are scoped by hostname, not port, so each localhost app needs its own
// namespace or the sessions overwrite each other.
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

export const { handlers, signIn, signOut, auth } = NextAuth({
  session: { strategy: "jwt" },
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
  providers: [
    Keycloak({
      clientId: process.env.AUTH_KEYCLOAK_ID,
      clientSecret: process.env.AUTH_KEYCLOAK_SECRET,
      issuer: process.env.AUTH_KEYCLOAK_ISSUER,
    }),
  ],
  callbacks: {
    async jwt({ token, account }) {
      if (account) {
        // id_token for federated logout; access_token for the day the control
        // API checks authz.
        token.id_token = account.id_token;
        token.access_token = account.access_token;
      }
      return token;
    },
    async session({ session, token }) {
      // @ts-expect-error not in the default session type
      session.id_token = token.id_token;
      // @ts-expect-error not in the default session type
      session.access_token = token.access_token;
      return session;
    },
  },
});
