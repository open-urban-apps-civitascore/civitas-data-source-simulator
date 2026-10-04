import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// One in-memory table shared by every writer, so a second registration sees
// the rows the first one wrote — exactly what a restart against Postgres sees.
const table = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[], writes: 0 }));

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
    close: vi.fn(async () => undefined),
  })),
}));

import { Registry } from "./registry.js";
import { simulationInputSchema, type SimulationInput } from "./types.js";

function sqlInput(scenario: Record<string, unknown>): SimulationInput {
  return simulationInputSchema.parse({
    transport: { kind: "sql", dsn: "postgres://demo@db:5432/demo_source", table: "kataster.baeume" },
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

    // Seeding would append another `seedRows` here; a fill only tops up.
    const second = new Registry();
    await second.put("kataster", sqlInput({ cadence: "fillToLimit", maxRows: 25 }));

    expect(table.rows).toHaveLength(25);
    expect(table.writes).toBe(writesBefore);
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
});
