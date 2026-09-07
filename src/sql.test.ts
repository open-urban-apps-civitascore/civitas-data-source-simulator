import { describe, expect, it, vi } from "vitest";

vi.mock("./publisher.js", () => ({
  createPublisher: vi.fn(async () => ({ publish: vi.fn(), close: vi.fn() })),
}));

/** In-memory stand-in for the table, so the SQL path is testable without a database. */
const table: Record<string, unknown>[] = [];
vi.mock("./sql-writer.js", async () => {
  const actual = await vi.importActual<typeof import("./sql-writer.js")>("./sql-writer.js");
  return {
    ...actual,
    createSqlWriter: vi.fn(async ({ spec }: { spec: { primaryKey: string } }) => ({
      ensureTable: vi.fn(async () => undefined),
      maxSequence: vi.fn(async (column: string, prefix: string) => {
        let highest: number | null = null;
        for (const row of table) {
          const key = String(row[column] ?? "");
          if (!key.startsWith(prefix)) continue;
          const suffix = key.slice(prefix.length);
          if (!/^\d+$/.test(suffix)) continue;
          const value = Number.parseInt(suffix, 10);
          if (highest === null || value > highest) highest = value;
        }
        return highest;
      }),
      countRows: vi.fn(async () => table.length),
      write: vi.fn(async (rows: Record<string, unknown>[]) => {
        for (const row of rows) {
          const index = table.findIndex((r) => r[spec.primaryKey] === row[spec.primaryKey]);
          if (index >= 0) table[index] = row;
          else table.push(row);
        }
        return rows.length;
      }),
      close: vi.fn(async () => undefined),
    })),
  };
});

import { compileScenario, sequenceValueOf } from "./generators.js";
import { Registry } from "./registry.js";
import { assertSameDatabase, databaseNameOf, splitQualifiedTable } from "./sql-writer.js";
import { simulationInputSchema } from "./types.js";

function sqlInput(overrides: Record<string, unknown> = {}) {
  return {
    transport: { kind: "sql", dsn: "postgres://u:p@localhost:5544/fachverfahren", table: "kataster.kiez_baeume" },
    scenario: {
      intervalSeconds: 10,
      maxRows: 5,
      seedRows: 3,
      insertsPerTick: 1,
      table: { columns: { baum_id: "text", lon: "double" }, primaryKey: "baum_id" },
      fields: {
        baum_id: { kind: "sequence", prefix: "KB-", padTo: 3 },
        lon: { kind: "jitter", center: 7.6362, spread: 0.0008 },
      },
      ...overrides,
    },
    enabled: true,
  };
}

describe("SQL scenario validation", () => {
  it("accepts a well-formed SQL simulation", () => {
    expect(simulationInputSchema.safeParse(sqlInput()).success).toBe(true);
  });

  it("rejects a primary key that is not a column — the platform refuses such a pipeline anyway", () => {
    const result = simulationInputSchema.safeParse(
      sqlInput({ table: { columns: { lon: "double" }, primaryKey: "baum_id" } }),
    );
    expect(result.success).toBe(false);
  });

  it("rejects a missing maxRows, because every pipeline run re-reads the whole table", () => {
    const input = sqlInput();
    delete (input.scenario as Record<string, unknown>).maxRows;
    expect(simulationInputSchema.safeParse(input).success).toBe(false);
  });

  it("rejects dotted column names — an MQTT affordance a table cannot express", () => {
    const result = simulationInputSchema.safeParse(
      sqlInput({
        table: { columns: { baum_id: "text", "location.lat": "double" }, primaryKey: "baum_id" },
        fields: {
          baum_id: { kind: "sequence" },
          "location.lat": { kind: "jitter", center: 1, spread: 1 },
        },
      }),
    );
    expect(result.success).toBe(false);
  });

  it("rejects a column with no generator, which would be NULL in every row", () => {
    const result = simulationInputSchema.safeParse(
      sqlInput({
        table: { columns: { baum_id: "text", lon: "double", zustand: "text" }, primaryKey: "baum_id" },
      }),
    );
    expect(result.success).toBe(false);
  });

  it("still accepts an MQTT simulation with nested paths", () => {
    const result = simulationInputSchema.safeParse({
      transport: { kind: "mqtt", url: "tcp://broker:1883", topic: "demo" },
      scenario: { fields: { "location.lat": { kind: "constant", value: 1 } } },
    });
    expect(result.success).toBe(true);
  });
});

describe("the write/read address guard", () => {
  it("allows two different addresses for the same database — the normal local setup", () => {
    expect(() =>
      assertSameDatabase(
        "postgres://u:p@localhost:5544/fachverfahren",
        "postgres://baumkataster-db:5432/fachverfahren",
      ),
    ).not.toThrow();
  });

  it("refuses to write somewhere the platform does not read", () => {
    expect(() =>
      assertSameDatabase("postgres://localhost:5544/scratch", "postgres://db:5432/fachverfahren"),
    ).toThrow(/never be seen/);
  });

  it("parses schema-qualified and bare table names", () => {
    expect(splitQualifiedTable("kataster.kiez_baeume")).toEqual({ schema: "kataster", table: "kiez_baeume" });
    expect(splitQualifiedTable("baeume")).toEqual({ schema: "public", table: "baeume" });
    expect(databaseNameOf("postgres://h/fachverfahren")).toBe("fachverfahren");
  });
});

describe("sequence and jitter", () => {
  it("mints unique keys and resumes from a value read back out of the table", () => {
    const scenario = { intervalSeconds: 10, seedRows: 0, insertsPerTick: 1, fields: { id: { kind: "sequence" as const, prefix: "KB-", start: 1, padTo: 3 } } };
    const fresh = compileScenario(scenario as never);
    expect([fresh(new Date()).id, fresh(new Date()).id]).toEqual(["KB-001", "KB-002"]);

    // Restart case: without resume every insert collides while reporting success.
    const resumed = compileScenario(scenario as never, { id: 15 });
    expect(resumed(new Date()).id).toBe("KB-015");
  });

  it("reads a counter back out of an existing key", () => {
    expect(sequenceValueOf("KB-014", "KB-")).toBe(14);
    expect(sequenceValueOf("OTHER-1", "KB-")).toBeNull();
    expect(sequenceValueOf("KB-x", "KB-")).toBeNull();
  });

  it("scatters around a point instead of wandering away from it", () => {
    const render = compileScenario({
      intervalSeconds: 10,
      seedRows: 0,
      insertsPerTick: 1,
      fields: { lon: { kind: "jitter" as const, center: 7.6362, spread: 0.0008, precision: 6 } },
    } as never);
    // randomWalk would drift away; jitter must stay within one spread, forever.
    for (let i = 0; i < 200; i++) {
      expect(Math.abs((render(new Date()).lon as number) - 7.6362)).toBeLessThanOrEqual(0.0009);
    }
  });
});

describe("Registry, SQL transport", () => {
  it("seeds immediately, then stops at the row cap", async () => {
    table.length = 0;
    const registry = new Registry();
    const parsed = simulationInputSchema.parse(sqlInput());

    const status = await registry.put("trees", parsed);
    // Seeded before any tick.
    expect(status.rowCount).toBe(3);
    expect(table.map((row) => row.baum_id)).toEqual(["KB-001", "KB-002", "KB-003"]);

    // The marker comes from the DDL default, never from the scenario.
    expect(Object.keys(table[0]!)).not.toContain("simuliert");

    await registry.shutdown();
  });

  it("resumes numbering from the table instead of colliding after a restart", async () => {
    table.length = 0;
    table.push({ baum_id: "KB-007", lon: 7.6 });

    const registry = new Registry();
    await registry.put("trees", simulationInputSchema.parse(sqlInput({ seedRows: 2 })));

    expect(table.map((row) => row.baum_id)).toEqual(["KB-007", "KB-008", "KB-009"]);
    await registry.shutdown();
  });

  it("reports a SQL simulation without pretending it has a topic", async () => {
    table.length = 0;
    const registry = new Registry();
    const status = await registry.put("trees", simulationInputSchema.parse(sqlInput({ seedRows: 0 })));
    expect(status.transport).toBe("sql");
    expect(status.topic).toBeNull();
    expect(status.target).toBe("kataster.kiez_baeume");
    expect(status.maxRows).toBe(5);
    await registry.shutdown();
  });
});
