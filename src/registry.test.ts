import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

// Publishers handed out, to see which are still open.
const publishers = vi.hoisted(() => [] as { url: string; close: Mock }[]);
// A broker a test can take down and bring back.
const flaky = vi.hoisted(() => ({ down: false }));

vi.mock("./publisher.js", () => ({
  createPublisher: vi.fn(async ({ url }: { url: string }) => {
    if (url.includes("unreachable")) throw new Error("read ECONNRESET");
    if (url.includes("flaky") && flaky.down) throw new Error("Broker nicht erreichbar.");
    const publisher = { url, publish: vi.fn(async () => undefined), close: vi.fn(async () => undefined) };
    publishers.push(publisher);
    return publisher;
  }),
}));

import { Registry } from "./registry.js";
import { MemoryStore, type SimulationStore, type StoredSimulation } from "./store.js";
import type { SimulationInput } from "./types.js";

beforeEach(() => {
  publishers.length = 0;
  flaky.down = false;
});

function openBrokers(): string[] {
  return publishers.filter((publisher) => publisher.close.mock.calls.length === 0).map((publisher) => publisher.url);
}

function input(url: string, enabled = true): SimulationInput {
  return {
    transport: { kind: "mqtt", url, topic: "demo/topic" },
    scenario: { intervalSeconds: 10, fields: { value: { kind: "constant", value: 1 } } },
    enabled,
  };
}

describe("Registry.put", () => {
  it("rolls the registration back when the broker connect fails", async () => {
    const registry = new Registry();
    // Without the rollback this leaves a registered simulation whose publisher is
    // null — the exact "registered but silently never publishes" state the 502
    // exists to prevent.
    await expect(registry.put("sim-broken", input("tcp://unreachable:1883"))).rejects.toThrow(
      "read ECONNRESET",
    );
    expect(registry.list()).toHaveLength(0);
  });

  it("keeps a registration whose broker is reachable", async () => {
    const registry = new Registry();
    await registry.put("sim-ok", input("tcp://broker:1883"));
    expect(registry.list().map((simulation) => simulation.id)).toEqual(["sim-ok"]);
    await registry.shutdown();
  });

  it("keeps the old version running when the new one cannot start", async () => {
    const registry = new Registry();
    await registry.put("sim", input("tcp://broker:1883"));

    // This used to stop the old version first and lose both.
    await expect(registry.put("sim", input("tcp://unreachable:1883"))).rejects.toThrow("read ECONNRESET");

    expect(registry.getInput("sim")?.transport).toMatchObject({ url: "tcp://broker:1883" });
    expect(registry.get("sim")?.enabled).toBe(true);
    expect(openBrokers()).toEqual(["tcp://broker:1883"]);
    await registry.shutdown();
  });

  it("keeps the date it was first created when a simulation is replaced", async () => {
    let clock = new Date("2026-10-01T08:00:00Z");
    const registry = new Registry({ now: () => clock });
    await registry.put("sim", input("tcp://broker-a:1883"));
    clock = new Date("2026-10-02T08:00:00Z");
    await registry.put("sim", input("tcp://broker-b:1883"));

    expect(registry.get("sim")?.createdAt).toBe("2026-10-01T08:00:00.000Z");
    await registry.shutdown();
  });

  it("stops the old version once the new one runs", async () => {
    const registry = new Registry();
    await registry.put("sim", input("tcp://broker-a:1883"));
    await registry.put("sim", input("tcp://broker-b:1883"));

    expect(registry.getInput("sim")?.transport).toMatchObject({ url: "tcp://broker-b:1883" });
    expect(openBrokers()).toEqual(["tcp://broker-b:1883"]);
    await registry.shutdown();
  });
});

describe("Registry, overlapping changes to one simulation", () => {
  it("applies two saves one after the other", async () => {
    const registry = new Registry();
    // Both start before either has connected, like a double click.
    await Promise.all([
      registry.put("sim", input("tcp://broker-a:1883")),
      registry.put("sim", input("tcp://broker-b:1883")),
    ]);

    // Without the queue the first publisher kept running untracked.
    expect(openBrokers()).toEqual(["tcp://broker-b:1883"]);
    expect(registry.getInput("sim")?.transport).toMatchObject({ url: "tcp://broker-b:1883" });
    await registry.shutdown();
  });

  it("removes a simulation whose registration was still connecting", async () => {
    const registry = new Registry();
    await Promise.all([registry.put("sim", input("tcp://broker:1883")), registry.remove("sim")]);

    expect(registry.list()).toHaveLength(0);
    expect(openBrokers()).toEqual([]);
  });
});

describe("Registry.setEnabled", () => {
  it("leaves the simulation paused, with the reason, when resuming fails", async () => {
    const registry = new Registry();
    await registry.put("sim-paused", input("tcp://unreachable:1883", false));

    await expect(registry.setEnabled("sim-paused", true)).rejects.toThrow("read ECONNRESET");

    // Without this the simulation reads as active in the UI while nothing runs
    // behind it, and nothing says why.
    const [simulation] = registry.list();
    expect(simulation.enabled).toBe(false);
    expect(simulation.lastError).toContain("ECONNRESET");
  });

  it("marks a simulation enabled once it really started", async () => {
    const registry = new Registry();
    await registry.put("sim-ok", input("tcp://broker:1883", false));

    const simulation = await registry.setEnabled("sim-ok", true);

    expect(simulation?.enabled).toBe(true);
    expect(simulation?.lastError).toBeNull();
    await registry.shutdown();
  });
});

describe("Registry status", () => {
  it("reports the origin it was registered with, so the UI can match it to the portal", async () => {
    const registry = new Registry();
    const origin = {
      installationId: "inst-42",
      dataSet: { name: "Verkehrszählung Musterhausen", id: "c46fa1f9" },
      dataSource: { name: "Zählstellen-Feed", urn: "urn:core:standard:musterhausen:datasource:mobility:feed:abc" },
      stream: "zaehlstelle-promenade",
    };
    await registry.put("inst-42--zaehlstelle-promenade", {
      ...input("tcp://broker:1883"),
      name: "Verkehrszählung Musterhausen · Zählstelle Promenade",
      origin,
    });

    const [status] = registry.list();
    expect(status.name).toBe("Verkehrszählung Musterhausen · Zählstelle Promenade");
    expect(status.origin).toEqual(origin);
    await registry.shutdown();
  });

  it("reports no origin for a simulation made by hand", async () => {
    const registry = new Registry();
    await registry.put("handmade", input("tcp://broker:1883"));
    expect(registry.get("handmade")?.origin).toBeNull();
    await registry.shutdown();
  });
});

/** Refuses every write while `broken` is set. */
class BrokenStore extends MemoryStore {
  broken = false;

  override async save(simulation: StoredSimulation): Promise<void> {
    if (this.broken) throw new Error("store unavailable");
    await super.save(simulation);
  }

  override async remove(id: string): Promise<void> {
    if (this.broken) throw new Error("store unavailable");
    await super.remove(id);
  }
}

/** On or off per stored id. */
async function storedSwitches(store: SimulationStore): Promise<Record<string, boolean>> {
  return Object.fromEntries((await store.list()).map((simulation) => [simulation.id, simulation.input.enabled]));
}

describe("Registry, stored settings", () => {
  it("stores every change: registered, switched off and on, removed", async () => {
    const store = new MemoryStore();
    const registry = new Registry({ store });

    await registry.put("sim", input("tcp://broker:1883"));
    expect(await storedSwitches(store)).toEqual({ sim: true });
    await registry.setEnabled("sim", false);
    expect(await storedSwitches(store)).toEqual({ sim: false });
    await registry.setEnabled("sim", true);
    expect(await storedSwitches(store)).toEqual({ sim: true });
    await registry.remove("sim");
    expect(await storedSwitches(store)).toEqual({});
    await registry.shutdown();
  });

  it("leaves the store alone on shutdown, since stopping the service switches nothing off", async () => {
    const store = new MemoryStore();
    const registry = new Registry({ store });
    await registry.put("sim", input("tcp://broker:1883"));

    await registry.shutdown();

    expect(await storedSwitches(store)).toEqual({ sim: true });
  });

  it("stores nothing that could not start", async () => {
    const store = new MemoryStore();
    const registry = new Registry({ store });
    await registry.put("sim", input("tcp://broker:1883"));
    await registry.put("paused", input("tcp://unreachable:1883", false));

    await expect(registry.put("sim", input("tcp://unreachable:1883"))).rejects.toThrow("read ECONNRESET");
    await expect(registry.put("new", input("tcp://unreachable:1883"))).rejects.toThrow("read ECONNRESET");
    await expect(registry.setEnabled("paused", true)).rejects.toThrow("read ECONNRESET");

    expect(await storedSwitches(store)).toEqual({ sim: true, paused: false });
    const sim = (await store.list()).find((simulation) => simulation.id === "sim");
    expect(sim?.input.transport).toMatchObject({ url: "tcp://broker:1883" });
    await registry.shutdown();
  });

  it("does not register a simulation it cannot store", async () => {
    const store = new BrokenStore();
    store.broken = true;
    const registry = new Registry({ store });

    await expect(registry.put("sim", input("tcp://broker:1883"))).rejects.toThrow("store unavailable");

    expect(registry.list()).toHaveLength(0);
    expect(openBrokers()).toEqual([]);
  });

  it("keeps the old version when the new one cannot be stored", async () => {
    const store = new BrokenStore();
    const registry = new Registry({ store });
    await registry.put("sim", input("tcp://broker-a:1883"));
    store.broken = true;

    await expect(registry.put("sim", input("tcp://broker-b:1883"))).rejects.toThrow("store unavailable");

    expect(registry.getInput("sim")?.transport).toMatchObject({ url: "tcp://broker-a:1883" });
    expect(openBrokers()).toEqual(["tcp://broker-a:1883"]);
    const [kept] = await store.list();
    expect(kept?.input.transport).toMatchObject({ url: "tcp://broker-a:1883" });
    await registry.shutdown();
  });

  it("stays off, with the reason, when switching on cannot be stored", async () => {
    const store = new BrokenStore();
    const registry = new Registry({ store });
    await registry.put("sim", input("tcp://broker:1883", false));
    store.broken = true;

    await expect(registry.setEnabled("sim", true)).rejects.toThrow("store unavailable");

    expect(registry.get("sim")).toMatchObject({ enabled: false, lastError: "store unavailable" });
    expect(openBrokers()).toEqual([]);
  });

  it("keeps running when switching off cannot be stored", async () => {
    const store = new BrokenStore();
    const registry = new Registry({ store });
    await registry.put("sim", input("tcp://broker:1883"));
    store.broken = true;

    await expect(registry.setEnabled("sim", false)).rejects.toThrow("store unavailable");

    expect(registry.get("sim")?.enabled).toBe(true);
    expect(openBrokers()).toEqual(["tcp://broker:1883"]);
    await registry.shutdown();
  });

  it("keeps a simulation running when the store refuses to forget it", async () => {
    const store = new BrokenStore();
    const registry = new Registry({ store });
    await registry.put("sim", input("tcp://broker:1883"));
    store.broken = true;

    await expect(registry.remove("sim")).rejects.toThrow("store unavailable");

    expect(registry.list()).toHaveLength(1);
    expect(openBrokers()).toEqual(["tcp://broker:1883"]);
    await registry.shutdown();
  });
});

describe("Registry.resume", () => {
  const createdAt = new Date("2026-10-01T08:00:00Z");
  const stored = (id: string, url: string, enabled = true): StoredSimulation => ({
    id,
    input: input(url, enabled),
    createdAt,
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts what was on, registers what was off, and keeps the created date", async () => {
    const store = new MemoryStore();
    await store.save(stored("on", "tcp://broker-a:1883"));
    await store.save(stored("off", "tcp://broker-b:1883", false));
    const registry = new Registry({ store });

    await registry.resume();
    await vi.waitFor(() => expect(openBrokers()).toEqual(["tcp://broker-a:1883"]));

    expect(registry.list().map(({ id, enabled }) => ({ id, enabled }))).toEqual([
      { id: "on", enabled: true },
      { id: "off", enabled: false },
    ]);
    expect(registry.get("on")?.createdAt).toBe(createdAt.toISOString());
    await registry.shutdown();
  });

  it("keeps a simulation on while its broker is down, and retries with growing pauses", async () => {
    vi.useFakeTimers();
    flaky.down = true;
    const store = new MemoryStore();
    await store.save(stored("sim", "tcp://flaky:1883"));
    const registry = new Registry({ store });

    await registry.resume();
    await vi.advanceTimersByTimeAsync(0);
    // Stays on: an outage during a restart must not switch it off.
    expect(registry.get("sim")).toMatchObject({
      enabled: true,
      lastError: "Broker nicht erreichbar. Neuer Versuch in 5 s.",
    });

    await vi.advanceTimersByTimeAsync(5_000);
    expect(registry.get("sim")?.lastError).toContain("Neuer Versuch in 10 s.");

    flaky.down = false;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(openBrokers()).toEqual(["tcp://flaky:1883"]);
    expect(registry.get("sim")?.lastError).toBeNull();
    expect(await storedSwitches(store)).toEqual({ sim: true });
    await registry.shutdown();
  });

  it("stops retrying once someone switches the simulation off", async () => {
    vi.useFakeTimers();
    flaky.down = true;
    const store = new MemoryStore();
    await store.save(stored("sim", "tcp://flaky:1883"));
    const registry = new Registry({ store });
    await registry.resume();
    await vi.advanceTimersByTimeAsync(0);

    await registry.setEnabled("sim", false);
    flaky.down = false;
    await vi.advanceTimersByTimeAsync(600_000);

    expect(openBrokers()).toEqual([]);
    expect(registry.get("sim")?.enabled).toBe(false);
    expect(await storedSwitches(store)).toEqual({ sim: false });
    await registry.shutdown();
  });
});
