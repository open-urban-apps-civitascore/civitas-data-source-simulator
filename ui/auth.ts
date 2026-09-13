import NextAuth from "next-auth";
import Keycloak from "next-auth/providers/keycloak";

import { authConfig } from "./auth.config";

// Two issuers: the browser is redirected to the address it can reach, while
// token, userinfo and key lookups happen server side and may use the in-cluster
// address. They are the same string in local development.
const KC_EXTERNAL = process.env.KEYCLOAK_ISSUER ?? "";
const KC_INTERNAL = process.env.KEYCLOAK_INTERNAL_ISSUER ?? KC_EXTERNAL;
// Keycloak's default is RS256; a hardened realm may sign with ES256, and a
// mismatch fails the callback with an unexpected algorithm header.
const KC_ID_TOKEN_ALG = process.env.KEYCLOAK_ID_TOKEN_ALG ?? "RS256";

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Keycloak({
      clientId: process.env.KEYCLOAK_CLIENT_ID,
      clientSecret: process.env.KEYCLOAK_CLIENT_SECRET,
      issuer: KC_EXTERNAL,
      client: { id_token_signed_response_alg: KC_ID_TOKEN_ALG },
      authorization: { url: `${KC_EXTERNAL}/protocol/openid-connect/auth` },
      token: `${KC_INTERNAL}/protocol/openid-connect/token`,
      userinfo: `${KC_INTERNAL}/protocol/openid-connect/userinfo`,
      jwks_endpoint: `${KC_INTERNAL}/protocol/openid-connect/certs`,
    }),
  ],
});
