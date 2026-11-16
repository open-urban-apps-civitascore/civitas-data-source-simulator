import pg from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createSqlWriter, rowsPerStatement, type SqlWriter } from "./sql-writer.js";

describe("rowsPerStatement", () => {
  it("keeps every INSERT under Postgres' bind-parameter cap", () => {
    for (const columns of [1, 9, 10, 64, 200]) {
      expect(rowsPerStatement(columns) * columns).toBeLessThanOrEqual(65_535);
      expect((rowsPerStatement(columns) + 1) * columns).toBeGreaterThan(65_535);
    }
  });

  it("still writes one row at a time for a pathological width", () => {
    expect(rowsPerStatement(100_000)).toBe(1);
    expect(rowsPerStatement(0)).toBe(65_535);
  });
});

describe("createSqlWriter", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("says why it cannot reach the database", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    // Port 1 (tcpmux) is closed everywhere these tests run.
    const writer = createSqlWriter({
      dsn: "postgres://demo:pw@127.0.0.1:1/demo_source",
      table: "demo.readings",
      spec: { columns: { id: "text" }, primaryKey: "id" },
    });
    await expect(writer).rejects.toThrow("Unter 127.0.0.1:1 nimmt niemand Verbindungen an. Läuft die Datenbank");
  });
});

// Only with SIMULATOR_TEST_DSN set; each test uses its own schema, dropped afterwards.
const testDsn = process.env.SIMULATOR_TEST_DSN;

describe.skipIf(!testDsn)("SqlWriter.replace, against a real database", () => {
  let schema: string;
  let client: pg.Client;
  let writer: SqlWriter | null;
  const spec = { columns: { baum_id: "text" as const, feuchte: "integer" as const }, primaryKey: "baum_id" };
  const keysIn = async (table: string) =>
    (await client.query(`SELECT baum_id, feuchte, simuliert FROM ${table} ORDER BY baum_id`)).rows;

  beforeEach(async () => {
    schema = `simulator_test_${Math.random().toString(36).slice(2, 10)}`;
    client = new pg.Client({ connectionString: testDsn });
    await client.connect();
    writer = null;
  });

  afterEach(async () => {
    await writer?.close();
    await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await client.end();
  });

  it("replaces only its own series and never a row someone else wrote", async () => {
    writer = await createSqlWriter({ dsn: testDsn!, table: `${schema}.baeume`, spec });
    await writer.ensureTable();
    await client.query(
      `INSERT INTO "${schema}".baeume VALUES ('KB-001', 1, false), ('KB-900', 9, true), ('X-1', 5, true)`,
    );

    await writer.replace([{ baum_id: "KB-001", feuchte: 50 }, { baum_id: "KB-002", feuchte: 60 }], "KB-");

    expect(await keysIn(`"${schema}".baeume`)).toEqual([
      // Someone else's row under the same key is left as it was.
      { baum_id: "KB-001", feuchte: 1, simuliert: false },
      { baum_id: "KB-002", feuchte: 60, simuliert: true },
      // Another simulation's series is not touched.
      { baum_id: "X-1", feuchte: 5, simuliert: true },
    ]);
  });

  it("keeps the old rows when the new batch fails", async () => {
    writer = await createSqlWriter({ dsn: testDsn!, table: `${schema}.baeume`, spec });
    await writer.ensureTable();
    await writer.replace([{ baum_id: "KB-001", feuchte: 50 }], "KB-");

    await expect(writer.replace([{ baum_id: "KB-001", feuchte: "kein Wert" }], "KB-")).rejects.toThrow();
    expect(await keysIn(`"${schema}".baeume`)).toEqual([{ baum_id: "KB-001", feuchte: 50, simuliert: true }]);
    // The failed client was dropped, and the pool still works.
    await writer.replace([{ baum_id: "KB-001", feuchte: 51 }], "KB-");
    expect((await keysIn(`"${schema}".baeume`))[0]?.feuchte).toBe(51);
  });

  it("refuses to replace in a table it cannot tell its own rows in", async () => {
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`CREATE TABLE "${schema}".kataster (baum_id text PRIMARY KEY, feuchte integer)`);
    await client.query(`INSERT INTO "${schema}".kataster VALUES ('KB-001', 1)`);
    writer = await createSqlWriter({ dsn: testDsn!, table: `${schema}.kataster`, spec });
    await writer.ensureTable();

    await expect(writer.replace([{ baum_id: "KB-001", feuchte: 50 }], "KB-")).rejects.toThrow(/fehlt sie/);
    expect((await client.query(`SELECT count(*)::int AS n FROM "${schema}".kataster`)).rows[0]?.n).toBe(1);
  });
});
