import { describe, expect, it, vi } from "vitest";

vi.mock("./publisher.js", () => ({
  createPublisher: vi.fn(async ({ url }: { url: string }) => {
    if (url.includes("unreachable")) throw new Error("read ECONNRESET");
    return { publish: vi.fn(async () => undefined), close: vi.fn(async () => undefined) };
  }),
}));

import { Registry } from "./registry.js";
import type { SimulationInput } from "./types.js";

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
