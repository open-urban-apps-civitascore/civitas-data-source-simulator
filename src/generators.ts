import type { GeneratorSpec, Scenario } from "./types.js";

// Each generator holds its state in its own closure, so fields never interfere.

export type ValueFn = (now: Date) => unknown;

/** Hours apart, the short way round midnight (0..12). */
function hourDistance(a: number, b: number): number {
  const raw = Math.abs(a - b);
  return Math.min(raw, 24 - raw);
}

/** Bell curve around the nearest peak. sigma 2.5 ends the rush ~5 hours out. */
function dailyShape(hour: number, peakHours: number[]): number {
  const sigma = 2.5;
  const nearest = Math.min(...peakHours.map((peak) => hourDistance(hour, peak)));
  return Math.exp(-(nearest * nearest) / (2 * sigma * sigma));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function createGenerator(spec: GeneratorSpec, resumeFrom?: number): ValueFn {
  switch (spec.kind) {
    case "constant":
      return () => spec.value;

    case "now":
      return (now) => now.toISOString();

    case "enum":
      return () => spec.values[Math.floor(Math.random() * spec.values.length)];

    case "randomWalk": {
      // Start mid-range, so the first reading is not an outlier.
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

    case "sequence": {
      // Without `resumeFrom` a restart collides with every existing row.
      let next = resumeFrom ?? spec.start;
      return () => {
        const value = next;
        next += 1;
        return `${spec.prefix}${String(value).padStart(spec.padTo, "0")}`;
      };
    }

    case "jitter":
      return () => {
        const offset = (Math.random() * 2 - 1) * spec.spread;
        const factor = 10 ** spec.precision;
        return Math.round((spec.center + offset) * factor) / factor;
      };
  }
}

/** Counter out of an existing key; null if it does not match. */
export function sequenceValueOf(key: string, prefix: string): number | null {
  if (!key.startsWith(prefix)) return null;
  const suffix = key.slice(prefix.length);
  if (!/^\d+$/.test(suffix)) return null;
  return Number.parseInt(suffix, 10);
}

/** Write at a dotted path, creating intermediate objects. */
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

/** Built once at registration, so stateful generators keep their position. */
export function compileScenario(
  scenario: Scenario,
  /** Field name to next `sequence` value, read back from the table. */
  resume: Record<string, number> = {},
): (now: Date) => Record<string, unknown> {
  const fields = Object.entries(scenario.fields).map(
    ([path, spec]) => [path, createGenerator(spec, resume[path])] as const,
  );

  return (now) => {
    const record: Record<string, unknown> = {};
    for (const [path, valueFn] of fields) {
      setPath(record, path, valueFn(now));
    }
    return record;
  };
}
