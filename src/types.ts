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
  /** `${prefix}${n}` — the only kind that can mint a unique key for a SQL table. */
  z.object({
    kind: z.literal("sequence"),
    prefix: z.string().default(""),
    start: z.number().int().min(0).default(1),
    padTo: z.number().int().min(0).max(12).default(0),
  }),
  /**
   * Stateless scatter around `center`. The correct kind for coordinates:
   * `randomWalk` drifts, which draws a trail across the map instead of a cluster.
   */
  z.object({
    kind: z.literal("jitter"),
    center: z.number(),
    spread: z.number().positive(),
    precision: z.number().int().min(0).max(12).default(6),
  }),
]);

export type GeneratorSpec = z.infer<typeof generatorSpecSchema>;

/** No geometry: coordinates stay plain numbers until the sink builds the Point. */
export const columnTypeSchema = z.enum(["text", "integer", "double", "boolean", "timestamptz"]);

export type ColumnType = z.infer<typeof columnTypeSchema>;

/** Inline for now; eventually derived from the package's row structure. */
export const tableSpecSchema = z.object({
  columns: z.record(z.string(), columnTypeSchema),
  /** Required: the platform rejects a SQL pipeline whose target has no key. */
  primaryKey: z.string().min(1),
});

export type TableSpec = z.infer<typeof tableSpecSchema>;

/**
 * Field keys are dotted paths, so nested payloads (`location.lat`) need no extra
 * syntax. The record they build is the whole MQTT message, or one SQL row.
 */
export const scenarioSchema = z.object({
  intervalSeconds: z.number().positive().max(3600).default(10),
  fields: z.record(z.string(), generatorSpecSchema),

  // ── SQL only ────────────────────────────────────────────────────────────────
  table: tableSpecSchema.optional(),
  /** Written at start-up, so the map is never empty. */
  seedRows: z.number().int().min(0).max(10_000).default(0),
  insertsPerTick: z.number().int().min(0).max(100).default(1),
  /** Mandatory for SQL: every pipeline run re-reads the whole table. */
  maxRows: z.number().int().positive().max(100_000).optional(),
  /** States the fast-forward openly rather than faking a plausible rate. */
  timeCompression: z.string().optional(),
});

export type Scenario = z.infer<typeof scenarioSchema>;

export const mqttTransportSchema = z.object({
  kind: z.literal("mqtt").default("mqtt"),
  url: z.string().min(1),
  topic: z.string().min(1),
});

export const sqlTransportSchema = z.object({
  kind: z.literal("sql"),
  /** Override; the generator's own DEMO_DB_DSN is the default. See config.ts. */
  dsn: z.string().min(1).optional(),
  /** Schema-qualified, e.g. `kataster.kiez_baeume`. */
  table: z.string().min(1),
  /** Where the platform reads, if known — see `assertSameDatabase`. */
  readDsn: z.string().optional(),
});

export const simulationInputSchema = z
  .object({
    transport: z.union([mqttTransportSchema, sqlTransportSchema]),
    scenario: scenarioSchema,
    /** Registered but paused — lets the marketplace create a simulation without starting it. */
    enabled: z.boolean().default(true),
  })
  .superRefine((input, ctx) => {
    if (input.transport.kind !== "sql") return;

    if (!input.scenario.table) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["scenario", "table"],
        message: "A SQL simulation must describe its table (columns + primaryKey).",
      });
      return;
    }
    if (input.scenario.maxRows === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["scenario", "maxRows"],
        message: "maxRows is required for SQL: every pipeline run re-reads the whole table.",
      });
    }

    const columns = input.scenario.table.columns;
    const primaryKey = input.scenario.table.primaryKey;
    if (!(primaryKey in columns)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["scenario", "table", "primaryKey"],
        message: `primaryKey '${primaryKey}' is not one of the declared columns.`,
      });
    }

    for (const field of Object.keys(input.scenario.fields)) {
      if (field.includes(".")) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["scenario", "fields", field],
          message: `SQL column names cannot be dotted paths: '${field}'.`,
        });
        continue;
      }
      if (!(field in columns)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["scenario", "fields", field],
          message: `Field '${field}' is not a declared column of the table.`,
        });
      }
    }

    // A column with no generator is NULL in every row — and for the key, a collision.
    for (const column of Object.keys(columns)) {
      if (!(column in input.scenario.fields) && column !== SIMULATED_COLUMN) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["scenario", "fields"],
          message: `Column '${column}' has no field generator — every row would be NULL there.`,
        });
      }
    }
  });

export type SimulationInput = z.infer<typeof simulationInputSchema>;

/** Written by the generator on every row, so a scenario cannot switch it off. */
export const SIMULATED_COLUMN = "simuliert";
