import "next-auth";
import "next-auth/jwt";

declare module "next-auth" {
  interface Session {
    /** Set when a token refresh failed; the page guard sends these to /login. */
    error?: string;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    access_token?: string;
    refresh_token?: string;
    id_token?: string;
    expires_at?: number;
    error?: string;
  }
}
