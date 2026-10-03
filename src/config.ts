// The add-on ships the database SQL simulations write into (compose locally,
// deploy/demo.yaml in a cluster), so callers name a table, never an address and
// never a password.

// Load `.env` when there is one. Node's own loader, so no dependency, and it
// works under every runner — `tsx watch` swallows `--env-file`, which made the
// flag on the dev script look like it worked while the child never saw it.
try {
  process.loadEnvFile();
} catch {
  // No .env: the real environment is the configuration, which is the container case.
}

export const DEMO_DB_DSN_VAR = "DEMO_DB_DSN";
export const DEMO_BROKER_URL_VAR = "DEMO_BROKER_URL";

/** The broker as this service reaches it, which is not how NiFi does. No baked-in default. */
export function defaultBrokerUrl(): string | null {
  return process.env[DEMO_BROKER_URL_VAR]?.trim() || null;
}

/** No baked-in default: a wrong-but-plausible address is the failure to avoid. */
export function resolveSqlDsn(requestDsn: string | undefined): string {
  const dsn = requestDsn?.trim() || process.env[DEMO_DB_DSN_VAR]?.trim();
  if (!dsn) {
    throw new Error(
      `No database configured: set ${DEMO_DB_DSN_VAR} on the generator, or pass transport.dsn.`,
    );
  }
  return dsn;
}
