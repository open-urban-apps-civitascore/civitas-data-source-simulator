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

/**
 * How records arrive. `interval`: one every `intervalSeconds` (SQL: topped up to
 * `seedRows` at start, then `insertsPerTick` per tick). `fillToLimit`, SQL only:
 * the table is topped up to `maxRows` at start and nothing follows — the shape of
 * master data, which exists whole rather than growing. Either way a restart
 * writes only what the table lacks.
 */
export const cadenceSchema = z.enum(["interval", "fillToLimit"]);

export type Cadence = z.infer<typeof cadenceSchema>;

/**
 * What a tick does to the rows. `append` adds them. `replace` swaps the whole
 * table for a fresh batch of `maxRows` rows, its running numbers counted from
 * the start again, so the platform overwrites the same keys instead of
 * collecting new ones.
 */
export const writeModeSchema = z.enum(["append", "replace"]);

export type WriteMode = z.infer<typeof writeModeSchema>;

/** The whole list goes out on every fetch, so it stays small. */
export const MAX_REST_ROWS = 10_000;

/**
 * A replace rewrites every row on every tick, so it gets a budget of its own;
 * appending is held to `insertsPerTick`.
 */
export const MAX_REPLACE_ROWS = 10_000;
export const MAX_REPLACE_ROWS_PER_SECOND = 1_000;

/** How many rows a replace may rewrite per tick at this interval. */
export function replaceLimit(intervalSeconds: number): number {
  return Math.min(MAX_REPLACE_ROWS, Math.floor(MAX_REPLACE_ROWS_PER_SECOND * intervalSeconds));
}

/** Field keys are dotted paths, so `location.lat` needs no extra syntax. */
export const scenarioSchema = z.object({
  intervalSeconds: z.number().positive().max(3600).default(10),
  cadence: cadenceSchema.default("interval"),
  fields: z.record(z.string(), generatorSpecSchema),

  // SQL and REST.
  writeMode: writeModeSchema.default("append"),

  // SQL only.
  table: tableSpecSchema.optional(),
  /** Topped up to this many rows at start, so the map is never empty. */
  seedRows: z.number().int().min(0).max(10_000).default(0),
  insertsPerTick: z.number().int().min(0).max(100).default(1),
  /** Mandatory for SQL and REST: every pipeline run reads all rows. */
  maxRows: z.number().int().positive().max(100_000).optional(),
  /** States the fast-forward openly rather than faking a plausible rate. */
  timeCompression: z.string().optional(),
});

export type Scenario = z.infer<typeof scenarioSchema>;

// mqtt.js silently treats any other scheme as plain TCP.
const BROKER_SCHEMES = new Set(["mqtt:", "mqtts:", "tcp:", "ssl:", "tls:", "ws:", "wss:"]);

export const INVALID_BROKER_URL =
  "Die Broker-Adresse ist ungültig. Sie braucht ein Schema (mqtt, mqtts, tcp, ssl, tls, ws oder wss), einen Namen und, falls angegeben, einen gültigen Port, zum Beispiel mqtt://broker:1883.";

export function parseBrokerUrl(url: string): URL | null {
  const parsed = URL.canParse(url) ? new URL(url) : null;
  return parsed && BROKER_SCHEMES.has(parsed.protocol) && parsed.hostname ? parsed : null;
}

// Stored settings are shown to everyone signed in: no passwords in addresses.
export const BROKER_URL_WITH_CREDENTIALS =
  "Die Broker-Adresse darf weder Benutzername noch Passwort enthalten - der Generator speichert sie und zeigt sie allen Angemeldeten.";

export const mqttTransportSchema = z.object({
  kind: z.literal("mqtt").default("mqtt"),
  url: z
    .string()
    .trim()
    .refine((url) => parseBrokerUrl(url) !== null, INVALID_BROKER_URL)
    .refine((url) => {
      const parsed = parseBrokerUrl(url);
      return !parsed?.username && !parsed?.password;
    }, BROKER_URL_WITH_CREDENTIALS),
  topic: z.string().min(1),
});

/** Without user and password; undefined when it is no URL. */
function withoutCredentials(dsn: string | undefined): string | undefined {
  if (!dsn || !URL.canParse(dsn)) return undefined;
  const url = new URL(dsn);
  url.username = "";
  url.password = "";
  return url.toString();
}

// Callers name a table; the address is the generator's DEMO_DB_DSN (config.ts).
export const sqlTransportSchema = z.object({
  kind: z.literal("sql"),
  /** Schema-qualified, e.g. `kataster.kiez_baeume`. */
  table: z.string().min(1),
  /** Where the platform reads, if known; only its database name is compared (`assertSameDatabase`). */
  readDsn: z.string().optional().transform(withoutCredentials),
});

/** Rows kept in memory, served at `GET /data/{id}` for the platform's HTTP source. */
export const restTransportSchema = z.object({
  kind: z.literal("rest"),
});

/** The path the platform fetches a REST simulation's rows from. */
export function dataPathFor(id: string): string {
  return `/data/${encodeURIComponent(id)}`;
}

/** A portal artifact: the name a person sees there, and the ids that find it. */
export const artifactRefSchema = z.object({
  name: z.string().min(1).max(200),
  /** Logical CORE URN of the copy on the instance; a versioned form also matches. */
  urn: z.string().min(1).max(500).optional(),
  /** The portal's own id for the artifact, for a link. */
  id: z.string().min(1).max(100).optional(),
});

export type ArtifactRef = z.infer<typeof artifactRefSchema>;

/**
 * What a simulation belongs to on the platform, so a person can find it next to
 * the portal's artifacts and the UI can match it by id rather than by text. The
 * marketplace takes it from the installation record. It is a snapshot: every
 * registration replaces it, and nothing here keys the simulation — the id does.
 */
export const originSchema = z.object({
  installationId: z.string().min(1).max(100).optional(),
  useCase: z
    .object({ id: z.string().min(1).max(200), name: z.string().min(1).max(200), version: z.string().max(50).optional() })
    .optional(),
  dataSet: artifactRefSchema.optional(),
  dataSource: artifactRefSchema.optional(),
  dataStructure: artifactRefSchema.optional(),
  /** The stream's name in the package, as its author wrote it. */
  stream: z.string().min(1).max(200).optional(),
});

export type Origin = z.infer<typeof originSchema>;

export const simulationInputSchema = z
  .object({
    /** For people. The marketplace sends one built from the portal's names. */
    name: z.string().max(200).optional(),
    description: z.string().max(2000).optional(),
    origin: originSchema.optional(),
    transport: z.union([mqttTransportSchema, sqlTransportSchema, restTransportSchema]),
    scenario: scenarioSchema,
    /** Registered but paused. */
    enabled: z.boolean().default(true),
  })
  .superRefine((input, ctx) => {
    const { transport, scenario } = input;
    if (transport.kind === "mqtt") {
      if (scenario.cadence === "fillToLimit") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["scenario", "cadence"],
          message: "fillToLimit is SQL and REST only: a broker keeps no rows to fill up to a limit.",
        });
      }
      if (scenario.writeMode === "replace") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["scenario", "writeMode"],
          message: "Ersetzen gibt es nur für SQL und REST: ein Broker hält keine Zeilen, die ersetzt werden könnten.",
        });
      }
      return;
    }

    if (scenario.writeMode === "replace" && scenario.cadence === "fillToLimit") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["scenario", "writeMode"],
        message: "Ersetzen braucht einen Takt: „Alles auf einmal“ schreibt nur beim Start.",
      });
    }
    if (scenario.writeMode === "replace" && scenario.maxRows !== undefined) {
      const limit = replaceLimit(scenario.intervalSeconds);
      if (scenario.maxRows > limit) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["scenario", "maxRows"],
          message: `Ersetzen schreibt jeden Takt alle Zeilen neu, deshalb höchstens ${MAX_REPLACE_ROWS_PER_SECOND.toLocaleString("de-DE")} Zeilen pro Sekunde: bei einem Takt von ${scenario.intervalSeconds} s also höchstens ${limit.toLocaleString("de-DE")} Zeilen.`,
        });
      }
    }

    if (transport.kind === "rest") {
      // The list lives in memory: a growing one would restart its keys after a restart.
      if (scenario.cadence === "interval" && scenario.writeMode !== "replace") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["scenario", "writeMode"],
          message:
            "Eine REST-Liste wächst nicht: sie lebt im Speicher, und nach einem Neustart würden ihre Laufnummern von vorn beginnen. „Ersetzen“ oder „Alles auf einmal“ wählen.",
        });
      }
      if (scenario.maxRows === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["scenario", "maxRows"],
          message: "maxRows ist für REST Pflicht: jeder Abruf liefert die ganze Liste.",
        });
      } else if (scenario.maxRows > MAX_REST_ROWS) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["scenario", "maxRows"],
          message: `Eine REST-Liste hat höchstens ${MAX_REST_ROWS.toLocaleString("de-DE")} Zeilen: jeder Abruf liefert sie ganz.`,
        });
      }
      return;
    }

    if (!scenario.table) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["scenario", "table"],
        message: "A SQL simulation must describe its table (columns + primaryKey).",
      });
      return;
    }
    if (scenario.maxRows === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["scenario", "maxRows"],
        message: "maxRows is required for SQL: every pipeline run re-reads the whole table.",
      });
    }

    let columns: Record<string, string>;
    let primaryKey: string;
    try {
      ({ columns, primaryKey } = resolveTable(scenario.table));
    } catch (error) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["scenario", "table"],
        message: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    // Each batch starts its keys over; anything but a counter would repeat within one.
    if (scenario.writeMode === "replace" && scenario.fields[primaryKey]?.kind !== "sequence") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["scenario", "fields", primaryKey],
        message: `Beim Ersetzen braucht der Primärschlüssel „${primaryKey}“ eine laufende Nummer: jede Ladung beginnt wieder bei denselben Schlüsseln.`,
      });
    }

    for (const field of Object.keys(scenario.fields)) {
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
