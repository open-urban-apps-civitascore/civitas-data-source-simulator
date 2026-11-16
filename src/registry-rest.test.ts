import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Registry } from "./registry.js";
import { MemoryStore } from "./store.js";
import { simulationInputSchema, type SimulationInput } from "./types.js";

function restInput(scenario: Record<string, unknown> = {}, enabled = true): SimulationInput {
  return simulationInputSchema.parse({
    transport: { kind: "rest" },
    scenario: {
      intervalSeconds: 10,
      writeMode: "replace",
      fields: {
        stadtteil: { kind: "sequence", prefix: "st-", padTo: 2 },
        "lage.lat": { kind: "constant", value: 49.79 },
      },
      maxRows: 3,
      ...scenario,
    },
    enabled,
  });
}

const keys = (rows: readonly Record<string, unknown>[] | null) => rows?.map((row) => row.stadtteil);

describe("Registry, REST", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("serves the rows as nested records and replaces them every tick, with the same keys", async () => {
    const registry = new Registry();
    const status = await registry.put("einwohner", restInput());

    expect(status).toMatchObject({ transport: "rest", target: "/data/einwohner", rowCount: 3 });
    expect(registry.records("einwohner")?.[0]).toEqual({ stadtteil: "st-01", lage: { lat: 49.79 } });

    await vi.advanceTimersByTimeAsync(20_000);
    expect(keys(registry.records("einwohner"))).toEqual(["st-01", "st-02", "st-03"]);
    expect(registry.get("einwohner")?.publishedCount).toBe(9);
    await registry.shutdown();
  });

  it("fills a fixed list once, and a restart writes the same keys again", async () => {
    const store = new MemoryStore();
    const first = new Registry({ store });
    await first.put("kataster", restInput({ writeMode: "append", cadence: "fillToLimit" }));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(keys(first.records("kataster"))).toEqual(["st-01", "st-02", "st-03"]);
    await first.shutdown();

    const second = new Registry({ store });
    await second.resume();
    await vi.advanceTimersByTimeAsync(0);
    expect(keys(second.records("kataster"))).toEqual(["st-01", "st-02", "st-03"]);
    await second.shutdown();
  });

  it("keeps the list through a pause and an edit", async () => {
    const registry = new Registry();
    await registry.put("einwohner", restInput());
    await registry.setEnabled("einwohner", false);
    await registry.put("einwohner", restInput({ intervalSeconds: 30 }, false));
    expect(keys(registry.records("einwohner"))).toEqual(["st-01", "st-02", "st-03"]);
    await registry.shutdown();
  });

  it("restarts only the first running number when it replaces", async () => {
    const registry = new Registry();
    await registry.put(
      "einwohner",
      restInput({ maxRows: 2, fields: { stadtteil: { kind: "sequence", prefix: "st-", padTo: 2 }, messung: { kind: "sequence" } } }),
    );
    await vi.advanceTimersByTimeAsync(10_000);
    expect(registry.records("einwohner")).toEqual([
      { stadtteil: "st-01", messung: "3" },
      { stadtteil: "st-02", messung: "4" },
    ]);
    await registry.shutdown();
  });

  it("serves an empty list for a simulation created paused, and nothing for other kinds", async () => {
    const registry = new Registry();
    await registry.put("einwohner", restInput({}, false));
    expect(registry.records("einwohner")).toEqual([]);
    expect(registry.records("unknown")).toBeNull();
    await registry.shutdown();
  });
});
