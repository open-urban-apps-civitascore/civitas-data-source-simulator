import { z } from "zod";

import { resolveTable } from "./row-schema.js";

// Payloads use the use case's own format, not SensorThings. Mapping to
// SensorThings is the pipeline's job, which keeps a real device a drop-in swap.

/** Closed union, so a bad generator is rejected at registration, not at publish. */
export const generatorSpecSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("constant"), value: z.unknown() }),
  /** ISO-8601 timestamp of the publish. */
  z.object({ kind: z.literal("now") }),
  z.object({ kind: z.literal("enum"), values: z.array(z.unknown()).min(1) }),
  /** Drifts within [min, max], at most `step` per tick. Stateful. */
  z.object({
    kind: z.literal("randomWalk"),
    min: z.number(),
    max: z.number(),
    step: z.number().positive(),
    start: z.number().optional(),
    integer: z.boolean().default(false),
  }),
  /** Follows the clock: low at night, peaking at `peakHours`. */
  z.object({
    kind: z.literal("dailyProfile"),
    min: z.number(),
    max: z.number(),
    peakHours: z.array(z.number().min(0).max(23)).min(1),
    /** Relative jitter, 0..1. */
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
  /** Stateless scatter. For coordinates; `randomWalk` would draw a trail. */
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

export const tableSpecSchema = z.object({
  /** A JSON Schema describing one row. Columns are derived from its properties. */
  rowSchema: z.unknown().optional(),
  /** Where the row class sits inside it: '#' for the root, or '#/$defs/Name'. */
  rowClass: z.string().default("#"),
  /** The whole list when no schema is sent; otherwise per-column overrides. */
  columns: z.record(z.string(), columnTypeSchema).default({}),
  /** Optional only when the schema marks a property `x-core-primaryKey`. */
  primaryKey: z.string().min(1).optional(),
});

export type TableSpec = z.infer<typeof tableSpecSchema>;

/** Field keys are dotted paths, so `location.lat` needs no extra syntax. */
export const scenarioSchema = z.object({
  intervalSeconds: z.number().positive().max(3600).default(10),
  fields: z.record(z.string(), generatorSpecSchema),

  // SQL only.
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
    /** For the simulator's UI. The marketplace registers by id and sends neither. */
    name: z.string().max(200).optional(),
    description: z.string().max(2000).optional(),
    transport: z.union([mqttTransportSchema, sqlTransportSchema]),
    scenario: scenarioSchema,
    /** Registered but paused. */
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

    let columns: Record<string, string>;
    try {
      columns = resolveTable(input.scenario.table).columns;
    } catch (error) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["scenario", "table"],
        message: error instanceof Error ? error.message : String(error),
      });
      return;
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

    // A column with no generator would be NULL in every row.
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
