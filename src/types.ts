import { z } from "zod";

/**
 * The scenario describes the data a simulated sensor sends — in the USE CASE'S OWN
 * format, not SensorThings. A real device emits its own domain shape, so emitting
 * anything else would make the generator non-replaceable by real hardware, which is
 * the whole point (see docs/exploration/2026-07-28-demo-data-simulator-design.md).
 *
 * Translation into SensorThings is the pipeline's job (a `mapping` node), not ours.
 */

/**
 * One field's value source. A closed union so a scenario is validatable and a
 * malformed generator is rejected at registration rather than at publish time.
 */
export const generatorSpecSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("constant"), value: z.unknown() }),
  /** Current wall-clock time as an ISO-8601 string — the usual `timestamp` field. */
  z.object({ kind: z.literal("now") }),
  z.object({ kind: z.literal("enum"), values: z.array(z.unknown()).min(1) }),
  /**
   * Brownian-ish drift inside [min, max]. Stateful: each tick moves at most `step`
   * from the previous value, so consecutive readings look related rather than
   * independent — which is what makes a chart look like a sensor and not noise.
   */
  z.object({
    kind: z.literal("randomWalk"),
    min: z.number(),
    max: z.number(),
    step: z.number().positive(),
    start: z.number().optional(),
    integer: z.boolean().default(false),
  }),
  /**
   * A value that follows the clock: low at night, peaking at the given hours. This
   * is the generator that makes demo data *believable* — a flat random series
   * between two bounds immediately reads as fake.
   */
  z.object({
    kind: z.literal("dailyProfile"),
    min: z.number(),
    max: z.number(),
    peakHours: z.array(z.number().min(0).max(23)).min(1),
    /** Relative jitter, 0..1, applied to the curve value. */
    noise: z.number().min(0).max(1).default(0.1),
    integer: z.boolean().default(false),
  }),
]);

export type GeneratorSpec = z.infer<typeof generatorSpecSchema>;

/**
 * Field keys are dotted paths, so nested payloads (`location.lat`) need no extra
 * syntax. The record they build is the whole MQTT message.
 */
export const scenarioSchema = z.object({
  intervalSeconds: z.number().positive().max(3600).default(10),
  fields: z.record(z.string(), generatorSpecSchema),
});

export type Scenario = z.infer<typeof scenarioSchema>;

export const simulationInputSchema = z.object({
  transport: z.object({
    kind: z.literal("mqtt").default("mqtt"),
    url: z.string().min(1),
    topic: z.string().min(1),
  }),
  scenario: scenarioSchema,
  /** Registered but paused — lets the marketplace create a simulation without starting it. */
  enabled: z.boolean().default(true),
});

export type SimulationInput = z.infer<typeof simulationInputSchema>;
