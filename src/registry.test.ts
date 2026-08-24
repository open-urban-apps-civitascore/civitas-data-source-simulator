import { describe, expect, it, vi } from "vitest";

vi.mock("./publisher.js", () => ({
  createPublisher: vi.fn(async ({ url }: { url: string }) => {
    if (url.includes("unreachable")) throw new Error("read ECONNRESET");
    return { publish: vi.fn(async () => undefined), close: vi.fn(async () => undefined) };
  }),
}));

import { Registry } from "./registry.js";
import type { SimulationInput } from "./types.js";

function input(url: string): SimulationInput {
  return {
    transport: { kind: "mqtt", url, topic: "demo/topic" },
    scenario: { intervalSeconds: 10, fields: { value: { kind: "constant", value: 1 } } },
    enabled: true,
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
