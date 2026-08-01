import { describe, expect, it } from "vitest";

import { compileScenario, createGenerator, setPath } from "./generators.js";
import { scenarioSchema } from "./types.js";

const at = (hour: number) => new Date(2026, 6, 31, hour, 0, 0);

describe("createGenerator", () => {
  it("returns the configured constant", () => {
    const value = createGenerator({ kind: "constant", value: "counter-001" })(at(8));
    expect(value).toBe("counter-001");
  });

  it("renders `now` as an ISO string", () => {
    expect(createGenerator({ kind: "now" })(at(8))).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("keeps a random walk inside its bounds and moves by at most one step", () => {
    const walk = createGenerator({ kind: "randomWalk", min: 0, max: 10, step: 1, integer: false });
    let previous = walk(at(8)) as number;
    for (let i = 0; i < 200; i++) {
      const next = walk(at(8)) as number;
      expect(next).toBeGreaterThanOrEqual(0);
      expect(next).toBeLessThanOrEqual(10);
      expect(Math.abs(next - previous)).toBeLessThanOrEqual(1 + 1e-9);
      previous = next;
    }
  });

  it("peaks at the configured hour and troughs at night", () => {
    // Noise off, so the curve alone is under test.
    const spec = {
      kind: "dailyProfile",
      min: 2,
      max: 180,
      peakHours: [8, 17],
      noise: 0,
      integer: true,
    } as const;
    const peak = createGenerator(spec)(at(8)) as number;
    const night = createGenerator(spec)(at(3)) as number;
    const evening = createGenerator(spec)(at(17)) as number;

    expect(peak).toBeGreaterThan(night * 5);
    expect(evening).toBeGreaterThan(night * 5);
    expect(peak).toBeLessThanOrEqual(180);
    expect(night).toBeGreaterThanOrEqual(2);
    expect(Number.isInteger(peak)).toBe(true);
  });

  it("treats peak hours as circular around midnight", () => {
    const spec = { kind: "dailyProfile", min: 0, max: 100, peakHours: [0], noise: 0, integer: false } as const;
    // 23:00 is one hour from a midnight peak, so it must score far above 12:00.
    expect(createGenerator(spec)(at(23)) as number).toBeGreaterThan(createGenerator(spec)(at(12)) as number);
  });
});

describe("setPath", () => {
  it("creates nested objects for dotted paths", () => {
    const target: Record<string, unknown> = {};
    setPath(target, "location.lat", 49.79);
    setPath(target, "location.lon", 9.93);
    expect(target).toEqual({ location: { lat: 49.79, lon: 9.93 } });
  });
});

describe("compileScenario", () => {
  it("builds the use case's own record shape, not a SensorThings envelope", () => {
    const scenario = scenarioSchema.parse({
      intervalSeconds: 10,
      fields: {
        counterId: { kind: "constant", value: "counter-001" },
        timestamp: { kind: "now" },
        vehicleCount: { kind: "dailyProfile", min: 2, max: 180, peakHours: [8], integer: true },
        "location.lat": { kind: "constant", value: 49.79 },
      },
    });

    const record = compileScenario(scenario)(at(8));

    expect(Object.keys(record).sort()).toEqual(["counterId", "location", "timestamp", "vehicleCount"]);
    expect(record).not.toHaveProperty("things");
    expect(record).not.toHaveProperty("observations");
    expect(record.location).toEqual({ lat: 49.79 });
  });

  it("keeps stateful generators going across ticks rather than restarting", () => {
    const scenario = scenarioSchema.parse({
      fields: { v: { kind: "randomWalk", min: 0, max: 100, step: 1, start: 50 } },
    });
    const render = compileScenario(scenario);
    const first = render(at(8)).v as number;
    const second = render(at(8)).v as number;
    // A restarted walk would return to `start` every time.
    expect(Math.abs(second - first)).toBeLessThanOrEqual(1 + 1e-9);
  });
});
