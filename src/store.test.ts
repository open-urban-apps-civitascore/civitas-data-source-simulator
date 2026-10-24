import pg from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MemoryStore, PostgresStore, type StoredSimulation } from "./store.js";

function stored(id: string, enabled = true): StoredSimulation {
  return {
    id,
    input: {
      transport: { kind: "mqtt", url: "tcp://broker:1883", topic: "demo/topic" },
      scenario: {
        intervalSeconds: 10,
        cadence: "interval",
        fields: { value: { kind: "constant", value: 1 } },
        seedRows: 0,
        insertsPerTick: 1,
      },
      enabled,
    },
    createdAt: new Date("2026-10-23T10:00:00Z"),
  };
}

describe("MemoryStore", () => {
  it("keeps one record per id and forgets removed ones", async () => {
    const store = new MemoryStore();
    await store.save(stored("a"));
    await store.save(stored("b"));
    await store.save(stored("a", false));
    await store.remove("b");
    await store.remove("never-stored");

    expect(await store.list()).toEqual([stored("a", false)]);
  });

  it("copies in and out, so a caller cannot change what is stored", async () => {
    const store = new MemoryStore();
    const record = stored("a");
    await store.save(record);
    record.input.enabled = false;
    const [listed] = await store.list();
    listed!.input.enabled = false;

    expect((await store.list())[0]?.input.enabled).toBe(true);
  });
});

// Only with SIMULATOR_TEST_DSN set; each test uses its own schema, dropped afterwards.
const testDsn = process.env.SIMULATOR_TEST_DSN;

async function query(sql: string): Promise<Record<string, unknown>[]> {
  const client = new pg.Client({ connectionString: testDsn });
  await client.connect();
  try {
    return (await client.query(sql)).rows;
  } finally {
    await client.end();
  }
}

describe.skipIf(!testDsn)("PostgresStore, against a real database", () => {
  let schema: string;
  let store: PostgresStore;

  beforeEach(() => {
    schema = `simulator_test_${Math.random().toString(36).slice(2, 10)}`;
    store = new PostgresStore(testDsn!, { schema });
  });

  afterEach(async () => {
    await store.close();
    await query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  });

  it("migrates once, even when two instances start together", async () => {
    const other = new PostgresStore(testDsn!, { schema });
    await Promise.all([store.migrate(), other.migrate()]);
    await store.migrate();
    await other.close();

    expect(await query(`SELECT version FROM "${schema}".migrations`)).toEqual([{ version: 1 }]);
  });

  it("keeps what was saved for the next instance, one record per id", async () => {
    await store.migrate();
    await store.save(stored("a"));
    await store.save(stored("b"));
    await store.save(stored("a", false));
    await store.remove("b");
    await store.remove("never-stored");

    const next = new PostgresStore(testDsn!, { schema });
    expect(await next.list()).toEqual([stored("a", false)]);
    await next.close();
  });

  it("leaves out a row that no longer fits, and keeps it in the table", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await store.migrate();
    await store.save(stored("current"));
    await query(
      `INSERT INTO "${schema}".simulations (id, input, created_at)
       VALUES ('outdated', '{"transport": {"kind": "carrier-pigeon"}}', now())`,
    );

    expect((await store.list()).map((simulation) => simulation.id)).toEqual(["current"]);
    expect(logged).toHaveBeenCalledWith(expect.stringContaining("stored simulation outdated no longer fits"));
    expect(await query(`SELECT id FROM "${schema}".simulations ORDER BY id`)).toEqual([
      { id: "current" },
      { id: "outdated" },
    ]);
    logged.mockRestore();
  });
});
