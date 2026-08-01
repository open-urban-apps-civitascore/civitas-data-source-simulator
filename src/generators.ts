import type { GeneratorSpec, Scenario } from "./types.js";

/**
 * Value generation. Pure except for `Math.random`, and all state is held in the
 * closure a generator returns — so a simulation's fields cannot interfere with
 * another's, and a restart simply starts the walks over.
 */

export type ValueFn = (now: Date) => unknown;

/** Hours between two clock hours, going the short way round midnight (0..12). */
function hourDistance(a: number, b: number): number {
  const raw = Math.abs(a - b);
  return Math.min(raw, 24 - raw);
}

/**
 * Bell curve around the nearest peak hour. `sigma` of 2.5 gives a rush hour that
 * is clearly over by ~5 hours out, which matches how traffic and consumption
 * curves actually look.
 */
function dailyShape(hour: number, peakHours: number[]): number {
  const sigma = 2.5;
  const nearest = Math.min(...peakHours.map((peak) => hourDistance(hour, peak)));
  return Math.exp(-(nearest * nearest) / (2 * sigma * sigma));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function createGenerator(spec: GeneratorSpec): ValueFn {
  switch (spec.kind) {
    case "constant":
      return () => spec.value;

    case "now":
      return (now) => now.toISOString();

    case "enum":
      return () => spec.values[Math.floor(Math.random() * spec.values.length)];

    case "randomWalk": {
      // Start mid-range unless told otherwise, so the first reading is not an outlier.
      let current = spec.start ?? (spec.min + spec.max) / 2;
      return () => {
        current = clamp(current + (Math.random() * 2 - 1) * spec.step, spec.min, spec.max);
        return spec.integer ? Math.round(current) : current;
      };
    }

    case "dailyProfile":
      return (now) => {
        const hour = now.getHours() + now.getMinutes() / 60;
        const shaped = spec.min + (spec.max - spec.min) * dailyShape(hour, spec.peakHours);
        const jitter = 1 + (Math.random() * 2 - 1) * spec.noise;
        const value = clamp(shaped * jitter, spec.min, spec.max);
        return spec.integer ? Math.round(value) : value;
      };
  }
}

/** Write `value` at a dotted path, creating intermediate objects as needed. */
export function setPath(target: Record<string, unknown>, path: string, value: unknown): void {
  const segments = path.split(".");
  let cursor = target;
  for (let i = 0; i < segments.length - 1; i++) {
    const segment = segments[i]!;
    const existing = cursor[segment];
    if (typeof existing !== "object" || existing === null) {
      cursor[segment] = {};
    }
    cursor = cursor[segment] as Record<string, unknown>;
  }
  cursor[segments.at(-1)!] = value;
}

/**
 * Build one scenario's field generators once, at registration. Returned as a
 * closure set so stateful generators (randomWalk) keep their position between
 * ticks instead of restarting on every message.
 */
export function compileScenario(scenario: Scenario): (now: Date) => Record<string, unknown> {
  const fields = Object.entries(scenario.fields).map(
    ([path, spec]) => [path, createGenerator(spec)] as const,
  );

  return (now) => {
    const record: Record<string, unknown> = {};
    for (const [path, valueFn] of fields) {
      setPath(record, path, valueFn(now));
    }
    return record;
  };
}
