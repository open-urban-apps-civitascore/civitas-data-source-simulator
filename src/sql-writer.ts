import pg from "pg";

import { SIMULATED_COLUMN, type ColumnType, type TableSpec } from "./types.js";

/**
 * SQL output. Unlike the MQTT publisher this owns the table's lifetime: the platform
 * only creates tables at the receiving end of a pipeline, and its pre-release probe
 * checks reachability but never that the table exists.
 */

const COLUMN_DDL: Record<ColumnType, string> = {
  text: "text",
  integer: "integer",
  double: "double precision",
  boolean: "boolean",
  timestamptz: "timestamptz",
};

/** Column names are validated at registration, but a scenario still reaches DDL. */
function quoteIdent(name: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_$]*$/.test(name)) {
    throw new Error(`Unsafe SQL identifier: '${name}'`);
  }
  return `"${name}"`;
}

export function splitQualifiedTable(qualified: string): { schema: string; table: string } {
  const parts = qualified.split(".");
  if (parts.length === 1) return { schema: "public", table: parts[0]! };
  if (parts.length === 2) return { schema: parts[0]!, table: parts[1]! };
  throw new Error(`Table name must be 'table' or 'schema.table': '${qualified}'`);
}

export function databaseNameOf(dsn: string): string | null {
  try {
    const path = new URL(dsn).pathname.replace(/^\//, "");
    return path.length > 0 ? path : null;
  } catch {
    return null;
  }
}

/**
 * Write and read addresses are legitimately different strings for the same database
 * (`localhost:5544` here, `baumkataster-db:5432` inside the network), so only the
 * database name is compared — enough to catch writing where nobody reads.
 */
export function assertSameDatabase(writeDsn: string, readDsn: string | undefined): void {
  if (!readDsn) return;
  const write = databaseNameOf(writeDsn);
  const read = databaseNameOf(readDsn);
  if (write && read && write !== read) {
    throw new Error(
      `Refusing to write to database '${write}' while the platform reads '${read}' — ` +
        "the rows would never be seen.",
    );
  }
}

export interface SqlWriter {
  ensureTable(): Promise<void>;
  /** Highest counter already used for `prefix`, so a restart continues the series. */
  maxSequence(column: string, prefix: string): Promise<number | null>;
  countRows(): Promise<number>;
  write(rows: Record<string, unknown>[]): Promise<number>;
  close(): Promise<void>;
}

export interface SqlWriterOptions {
  dsn: string;
  table: string;
  spec: TableSpec;
}

export async function createSqlWriter({ dsn, table, spec }: SqlWriterOptions): Promise<SqlWriter> {
  const { schema, table: name } = splitQualifiedTable(table);
  const qualified = `${quoteIdent(schema)}.${quoteIdent(name)}`;
  const primaryKey = quoteIdent(spec.primaryKey);

  const pool = new pg.Pool({ connectionString: dsn, max: 2, connectionTimeoutMillis: 10_000 });
  // Fail at registration, not at the first tick.
  await pool.query("SELECT 1");

  const columns = Object.keys(spec.columns);

  return {
    async ensureTable() {
      const definitions = columns.map(
        (column) => `${quoteIdent(column)} ${COLUMN_DDL[spec.columns[column]!]}`,
      );
      // Appended here, never declared by the scenario, so it cannot be switched off.
      definitions.push(`${quoteIdent(SIMULATED_COLUMN)} boolean NOT NULL DEFAULT true`);
      definitions.push(`PRIMARY KEY (${primaryKey})`);

      await pool.query(`CREATE SCHEMA IF NOT EXISTS ${quoteIdent(schema)}`);
      await pool.query(`CREATE TABLE IF NOT EXISTS ${qualified} (\n  ${definitions.join(",\n  ")}\n)`);
    },

    async maxSequence(column, prefix) {
      const { rows } = await pool.query<{ key: string }>(
        `SELECT ${quoteIdent(column)} AS key FROM ${qualified} WHERE ${quoteIdent(column)} LIKE $1`,
        [`${prefix.replace(/[%_\\]/g, "\\$&")}%`],
      );
      let highest: number | null = null;
      for (const row of rows) {
        const suffix = row.key.slice(prefix.length);
        if (!/^\d+$/.test(suffix)) continue;
        const value = Number.parseInt(suffix, 10);
        if (highest === null || value > highest) highest = value;
      }
      return highest;
    },

    async countRows() {
      const { rows } = await pool.query<{ count: string }>(`SELECT count(*) AS count FROM ${qualified}`);
      return Number.parseInt(rows[0]?.count ?? "0", 10);
    },

    async write(rows) {
      if (rows.length === 0) return 0;
      const placeholders: string[] = [];
      const values: unknown[] = [];
      rows.forEach((row, rowIndex) => {
        const slots = columns.map((_, columnIndex) => `$${rowIndex * columns.length + columnIndex + 1}`);
        placeholders.push(`(${slots.join(", ")})`);
        values.push(...columns.map((column) => row[column] ?? null));
      });

      // Upsert, never delete: the sink only inserts-or-overwrites, so a row removed
      // here would stay on the map forever.
      const updates = columns
        .filter((column) => column !== spec.primaryKey)
        .map((column) => `${quoteIdent(column)} = EXCLUDED.${quoteIdent(column)}`);

      const conflict = updates.length
        ? `ON CONFLICT (${primaryKey}) DO UPDATE SET ${updates.join(", ")}`
        : `ON CONFLICT (${primaryKey}) DO NOTHING`;

      const result = await pool.query(
        `INSERT INTO ${qualified} (${columns.map(quoteIdent).join(", ")})
         VALUES ${placeholders.join(", ")}
         ${conflict}`,
        values,
      );
      return result.rowCount ?? 0;
    },

    async close() {
      await pool.end();
    },
  };
}
