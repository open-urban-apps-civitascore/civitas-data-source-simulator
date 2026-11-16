import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// One in-memory table shared by every writer, so a second registration sees
// the rows the first one wrote — exactly what a restart against Postgres sees.
const table = vi.hoisted(() => ({
  rows: [] as Record<string, unknown>[],
  writes: 0,
  /** Replaces begun, and a gate a test can hold them at. */
  replacing: 0,
  hold: null as Promise<void> | null,
  prefixes: [] as (string | undefined)[],
}));

vi.mock("./sql-writer.js", () => ({
  assertSameDatabase: vi.fn(),
  createSqlWriter: vi.fn(async () => ({
    ensureTable: vi.fn(async () => undefined),
    maxSequence: vi.fn(async (column: string, prefix: string) => {
      const numbers = table.rows
        .map((row) => String(row[column]).slice(prefix.length))
        .filter((suffix) => /^\d+$/.test(suffix))
        .map(Number);
      return numbers.length ? Math.max(...numbers) : null;
    }),
    countRows: vi.fn(async () => table.rows.length),
    write: vi.fn(async (rows: Record<string, unknown>[]) => {
      table.writes += 1;
      table.rows.push(...rows);
      return rows.length;
    }),
    replace: vi.fn(async (rows: Record<string, unknown>[], keyPrefix?: string) => {
      table.replacing += 1;
      table.prefixes.push(keyPrefix);
      if (table.hold) await table.hold;
      table.writes += 1;
      table.rows = [...rows];
      return rows.length;
    }),
    close: vi.fn(async () => undefined),
  })),
}));

import { DEMO_DB_DSN_VAR } from "./config.js";
import { Registry } from "./registry.js";
import { simulationInputSchema, type SimulationInput } from "./types.js";

// Set here, not taken from a local .env.
process.env[DEMO_DB_DSN_VAR] = "postgres://demo@db:5432/demo_source";

function sqlInput(scenario: Record<string, unknown>): SimulationInput {
  return simulationInputSchema.parse({
    transport: { kind: "sql", table: "kataster.baeume" },
    scenario: {
      intervalSeconds: 10,
      table: { columns: { baum_id: "text", art: "text" }, primaryKey: "baum_id" },
      fields: {
        baum_id: { kind: "sequence", prefix: "KB-", padTo: 3 },
        art: { kind: "constant", value: "Winterlinde" },
      },
      ...scenario,
    },
  });
}

describe("Registry, SQL cadence", () => {
  beforeEach(() => {
    table.rows = [];
    table.writes = 0;
    table.replacing = 0;
    table.hold = null;
    table.prefixes = [];
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("fills the table to the limit at once and writes nothing after", async () => {
    const registry = new Registry();
    const status = await registry.put("kataster", sqlInput({ cadence: "fillToLimit", maxRows: 25 }));

    expect(table.rows).toHaveLength(25);
    expect(table.rows.at(-1)?.baum_id).toBe("KB-025");
    expect(status).toMatchObject({ cadence: "fillToLimit", rowCount: 25, atCap: true });

    // No timer: an hour later the table holds the same rows.
    await vi.advanceTimersByTimeAsync(3_600_000);
    expect(table.rows).toHaveLength(25);
    await registry.shutdown();
  });

  it("adds nothing when a restart finds the table already full", async () => {
    const first = new Registry();
    await first.put("kataster", sqlInput({ cadence: "fillToLimit", maxRows: 25 }));
    await first.shutdown();
    const writesBefore = table.writes;

    // A fill counts before it writes, so a full table gets nothing more.
    const second = new Registry();
    const status = await second.put("kataster", sqlInput({ cadence: "fillToLimit", maxRows: 25 }));

    expect(table.rows).toHaveLength(25);
    expect(table.writes).toBe(writesBefore);
    // Still reads as full.
    expect(status).toMatchObject({ rowCount: 25, atCap: true });
    await second.shutdown();
  });

  it("tops up only what is missing, continuing the key series", async () => {
    table.rows = [{ baum_id: "KB-001", art: "Winterlinde" }, { baum_id: "KB-002", art: "Winterlinde" }];
    const registry = new Registry();
    await registry.put("kataster", sqlInput({ cadence: "fillToLimit", maxRows: 5 }));

    expect(table.rows.map((row) => row.baum_id)).toEqual(["KB-001", "KB-002", "KB-003", "KB-004", "KB-005"]);
    await registry.shutdown();
  });

  it("keeps the interval cadence: seed at start, then one tick's rows per interval", async () => {
    const registry = new Registry();
    const status = await registry.put("messungen", sqlInput({ seedRows: 3, insertsPerTick: 2, maxRows: 100 }));

    expect(status.cadence).toBe("interval");
    expect(table.rows).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(table.rows).toHaveLength(5);
    await registry.shutdown();
  });

  it("tops the table up to the starting rows instead of adding them again", async () => {
    table.rows = [{ baum_id: "KB-001", art: "Winterlinde" }];
    const registry = new Registry();
    await registry.put("messungen", sqlInput({ seedRows: 3, maxRows: 100 }));

    expect(table.rows.map((row) => row.baum_id)).toEqual(["KB-001", "KB-002", "KB-003"]);
    await registry.shutdown();
  });

  it("replaces the whole table every tick, with the same keys each time", async () => {
    table.rows = [{ baum_id: "KB-900", art: "Eiche" }];
    const registry = new Registry();
    const status = await registry.put("baeume", sqlInput({ writeMode: "replace", maxRows: 3, seedRows: 50 }));

    // The leftover row is gone; the table holds one full batch.
    expect(table.rows.map((row) => row.baum_id)).toEqual(["KB-001", "KB-002", "KB-003"]);
    expect(status).toMatchObject({ writeMode: "replace", rowCount: 3, atCap: false });

    await vi.advanceTimersByTimeAsync(20_000);
    expect(table.rows.map((row) => row.baum_id)).toEqual(["KB-001", "KB-002", "KB-003"]);
    expect(table.writes).toBe(3);
    // Only its own key series is replaced; another simulation may share the table.
    expect(table.prefixes).toEqual(["KB-", "KB-", "KB-"]);
    await registry.shutdown();
  });

  it("restarts only the key in each batch; another running number keeps counting", async () => {
    const registry = new Registry();
    await registry.put(
      "baeume",
      simulationInputSchema.parse({
        transport: { kind: "sql", table: "kataster.baeume" },
        scenario: {
          intervalSeconds: 10,
          writeMode: "replace",
          maxRows: 2,
          table: { columns: { baum_id: "text", messung: "text" }, primaryKey: "baum_id" },
          fields: {
            baum_id: { kind: "sequence", prefix: "KB-", padTo: 3 },
            messung: { kind: "sequence", prefix: "M" },
          },
        },
      }),
    );
    await vi.advanceTimersByTimeAsync(10_000);

    expect(table.rows).toEqual([
      { baum_id: "KB-001", messung: "M3" },
      { baum_id: "KB-002", messung: "M4" },
    ]);
    await registry.shutdown();
  });

  it("skips a tick while the previous replace is still writing", async () => {
    const registry = new Registry();
    await registry.put("baeume", sqlInput({ writeMode: "replace", maxRows: 3 }));
    let release = () => undefined as void;
    table.hold = new Promise((resolve) => (release = resolve));

    await vi.advanceTimersByTimeAsync(40_000);
    // The start, then one tick that is still waiting; three more ticks skipped.
    expect(table.replacing).toBe(2);

    table.hold = null;
    release();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(table.replacing).toBe(3);
    await registry.shutdown();
  });

  it("writes no starting rows when a restart finds enough", async () => {
    const first = new Registry();
    await first.put("messungen", sqlInput({ seedRows: 3, maxRows: 100 }));
    await first.shutdown();
    const writesBefore = table.writes;

    // Every restart used to append the starting rows again.
    const second = new Registry();
    await second.put("messungen", sqlInput({ seedRows: 3, maxRows: 100 }));

    expect(table.rows).toHaveLength(3);
    expect(table.writes).toBe(writesBefore);
    await second.shutdown();
  });
});
