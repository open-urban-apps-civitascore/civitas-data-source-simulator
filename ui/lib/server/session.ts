import "server-only";

import { auth } from "@/auth";

/** Local UI work without a Keycloak at hand. */
export function authDisabled(): boolean {
  return process.env.SIMULATOR_SKIP_AUTH === "1";
}

/** Null while auth is disabled. */
export async function currentUser() {
  if (authDisabled()) return null;
  const session = await auth();
  return session?.user ?? null;
}

export async function isAuthorised(): Promise<boolean> {
  if (authDisabled()) return true;
  return Boolean(await currentUser());
}
