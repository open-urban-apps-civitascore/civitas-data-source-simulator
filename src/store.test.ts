import { describe, expect, it } from "vitest";

import { MemoryStore, type StoredSimulation } from "./store.js";

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
