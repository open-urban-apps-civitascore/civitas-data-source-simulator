/**
 * The generator's own database. The add-on ships one, so callers name a table —
 * not an address, and above all not a password, which has no business travelling
 * through an install dialog.
 */

export const DEMO_DB_DSN_VAR = "DEMO_DB_DSN";

/**
 * `transport.dsn` stays available as an override for the deferred case where an
 * operator points the generator at a database of their own. There is deliberately
 * no baked-in default: a wrong-but-plausible address is the failure mode this
 * whole path is built to avoid.
 */
export function resolveSqlDsn(requestDsn: string | undefined): string {
  const dsn = requestDsn?.trim() || process.env[DEMO_DB_DSN_VAR]?.trim();
  if (!dsn) {
    throw new Error(
      `No database configured: set ${DEMO_DB_DSN_VAR} on the generator, or pass transport.dsn.`,
    );
  }
  return dsn;
}
