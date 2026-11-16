import pg from "pg";

import { CONNECT_TIMEOUT_MS, describeDatabaseError } from "./connect-error.js";
import type { ResolvedTable } from "./row-schema.js";
import type { RowSink } from "./rows.js";
import { SIMULATED_COLUMN, type ColumnType } from "./types.js";

// Owns the table's lifetime: the platform only creates tables at the receiving
// end of a pipeline, and never checks that a source table exists.

const COLUMN_DDL: Record<ColumnType, string> = {
  text: "text",
  integer: "integer",
  double: "double precision",
  boolean: "boolean",
  timestamptz: "timestamptz",
};

/** Column names are validated at registration, but a scenario still reaches DDL. */
export function quoteIdent(name: string): string {
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

/** Only the database name is compared: the same database has two addresses. */
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

/** Postgres refuses a statement that binds more parameters than this. */
const MAX_BIND_PARAMETERS = 65_535;

/** Rows per INSERT: a fill or seed of a wide table would exceed the cap in one. */
export function rowsPerStatement(columnCount: number): number {
  return Math.max(1, Math.floor(MAX_BIND_PARAMETERS / Math.max(1, columnCount)));
}

export interface SqlWriter extends RowSink {
  ensureTable(): Promise<void>;
  close(): Promise<void>;
}

type Queryable = Pick<pg.ClientBase, "query">;

function likeEscape(text: string): string {
  return text.replace(/[%_\\]/g, "\\$&");
}

export interface SqlWriterOptions {
  dsn: string;
  table: string;
  spec: ResolvedTable;
}

export async function createSqlWriter({ dsn, table, spec }: SqlWriterOptions): Promise<SqlWriter> {
  const { schema, table: name } = splitQualifiedTable(table);
  const qualified = `${quoteIdent(schema)}.${quoteIdent(name)}`;
  const primaryKey = quoteIdent(spec.primaryKey);

  const pool = new pg.Pool({ connectionString: dsn, max: 2, connectionTimeoutMillis: CONNECT_TIMEOUT_MS });
  try {
    // Fail at registration, not at the first tick.
    await pool.query("SELECT 1");
  } catch (error) {
    const target = URL.canParse(dsn) ? new URL(dsn) : null;
    if (!target) throw error;
    console.error(`[demo-generator] database connect to ${target.host} failed:`, error);
    throw new Error(describeDatabaseError(target, error), { cause: error });
  }

  const columns = Object.keys(spec.columns);
  const simulated = quoteIdent(SIMULATED_COLUMN);

  // Upsert. Only `replace` deletes, and it writes the same keys straight back:
  // the platform never deletes, so a row removed for good would stay on its map.
  const updates = columns
    .filter((column) => column !== spec.primaryKey)
    .map((column) => `${quoteIdent(column)} = EXCLUDED.${quoteIdent(column)}`);

  const appendConflict = updates.length
    ? `ON CONFLICT (${primaryKey}) DO UPDATE SET ${updates.join(", ")}`
    : `ON CONFLICT (${primaryKey}) DO NOTHING`;
  // A replace never takes over a row someone else wrote under the same key.
  const replaceConflict = updates.length ? `${appendConflict} WHERE ${qualified}.${simulated}` : appendConflict;

  const insert = async (rows: Record<string, unknown>[], db: Queryable, conflict: string): Promise<number> => {
    const placeholders: string[] = [];
    const values: unknown[] = [];
    rows.forEach((row, rowIndex) => {
      const slots = columns.map((_, columnIndex) => `$${rowIndex * columns.length + columnIndex + 1}`);
      placeholders.push(`(${slots.join(", ")})`);
      values.push(...columns.map((column) => row[column] ?? null));
    });

    const result = await db.query(
      `INSERT INTO ${qualified} (${columns.map(quoteIdent).join(", ")})
       VALUES ${placeholders.join(", ")}
       ${conflict}`,
      values,
    );
    return result.rowCount ?? 0;
  };

  /** In statements small enough for the bind-parameter cap. */
  const insertAll = async (rows: Record<string, unknown>[], db: Queryable, conflict: string): Promise<number> => {
    const size = rowsPerStatement(columns.length);
    let written = 0;
    for (let start = 0; start < rows.length; start += size) {
      written += await insert(rows.slice(start, start + size), db, conflict);
    }
    return written;
  };

  /** False for a table someone else created: `replace` cannot tell its own rows there. */
  let marked = false;

  return {
    async ensureTable() {
      const definitions = columns.map(
        (column) => `${quoteIdent(column)} ${COLUMN_DDL[spec.columns[column]!]}`,
      );
      // Never declared by the scenario, so it cannot be switched off.
      definitions.push(`${simulated} boolean NOT NULL DEFAULT true`);
      definitions.push(`PRIMARY KEY (${primaryKey})`);

      await pool.query(`CREATE SCHEMA IF NOT EXISTS ${quoteIdent(schema)}`);
      await pool.query(`CREATE TABLE IF NOT EXISTS ${qualified} (\n  ${definitions.join(",\n  ")}\n)`);
      const { rowCount } = await pool.query(
        "SELECT 1 FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 AND column_name = $3",
        [schema, name, SIMULATED_COLUMN],
      );
      marked = (rowCount ?? 0) > 0;
    },

    async maxSequence(column, prefix) {
      const { rows } = await pool.query<{ key: string }>(
        `SELECT ${quoteIdent(column)} AS key FROM ${qualified} WHERE ${quoteIdent(column)} LIKE $1`,
        [`${likeEscape(prefix)}%`],
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
      return insertAll(rows, pool, appendConflict);
    },

    async replace(rows, keyPrefix = "") {
      if (!marked) {
        throw new Error(
          `Ersetzen löscht nur Zeilen, die der Generator geschrieben hat, und erkennt sie an der Spalte „${SIMULATED_COLUMN}“. ` +
            `Der Tabelle ${table} fehlt sie: sie wurde nicht vom Generator angelegt.`,
        );
      }
      const client = await pool.connect();
      let failure: Error | undefined;
      try {
        await client.query("BEGIN");
        // DELETE, not TRUNCATE: readers keep seeing the old rows until the commit.
        // Only this series: another simulation may write into the same table.
        await client.query(`DELETE FROM ${qualified} WHERE ${simulated} AND ${primaryKey} LIKE $1`, [
          `${likeEscape(keyPrefix)}%`,
        ]);
        const written = await insertAll(rows, client, replaceConflict);
        await client.query("COMMIT");
        return written;
      } catch (error) {
        failure = error instanceof Error ? error : new Error(String(error));
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      } finally {
        // A failed client is dropped, not handed out again.
        client.release(failure);
      }
    },

    async close() {
      await pool.end();
    },
  };
}
