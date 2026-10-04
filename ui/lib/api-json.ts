// Between the editor's draft and the control API's body. The JSON view shows
// exactly what PUT /simulations/{id} receives.

import type {
  GeneratorSpec,
  Origin,
  Scenario,
  SimulationDraft,
  SimulationInput,
  Transport,
  WireScenario,
} from "./types";

export function toInput(draft: SimulationDraft): SimulationInput {
  const fields: Record<string, GeneratorSpec> = {};
  for (const f of draft.scenario.fields) fields[f.name] = f.spec;
  const sql = draft.transport.kind === "sql";
  return {
    ...(draft.name ? { name: draft.name } : {}),
    ...(draft.description ? { description: draft.description } : {}),
    ...(draft.origin ? { origin: draft.origin } : {}),
    enabled: draft.enabled,
    transport: draft.transport,
    scenario: {
      // A fill has no interval and hides its input, so a value emptied before
      // the switch must not fail the save; the service's default stands in.
      intervalSeconds:
        sql && draft.scenario.cadence === "fillToLimit" && !Number.isFinite(draft.scenario.intervalSeconds)
          ? 10
          : draft.scenario.intervalSeconds,
      fields,
      ...(sql
        ? {
            table: {
              primaryKey: draft.scenario.primaryKey,
              columns: Object.fromEntries(
                draft.scenario.fields.map((f) => [f.name, columnTypeFor(f.spec)] as const),
              ),
            },
            seedRows: draft.scenario.seedRows ?? 0,
            insertsPerTick: draft.scenario.insertsPerTick ?? 1,
            maxRows: draft.scenario.maxRows,
            ...(draft.scenario.cadence === "fillToLimit" ? { cadence: "fillToLimit" as const } : {}),
          }
        : {}),
    },
  };
}

/** The service takes columns as given when no schema is sent. */
function columnTypeFor(spec: GeneratorSpec) {
  switch (spec.kind) {
    case "now":
      return "timestamptz" as const;
    case "sequence":
      return "text" as const;
    case "jitter":
      return "double" as const;
    case "randomWalk":
    case "dailyProfile":
      return spec.integer ? ("integer" as const) : ("double" as const);
    case "constant":
      return typeof spec.value === "number"
        ? Number.isInteger(spec.value)
          ? ("integer" as const)
          : ("double" as const)
        : typeof spec.value === "boolean"
          ? ("boolean" as const)
          : ("text" as const);
    case "enum": {
      const first = spec.values[0];
      return typeof first === "number"
        ? ("double" as const)
        : typeof first === "boolean"
          ? ("boolean" as const)
          : ("text" as const);
    }
  }
}

export function toScenario(draft: SimulationDraft): WireScenario {
  return toInput(draft).scenario;
}

/** What came back from the service, as the editor's draft. */
export function toDraft(input: SimulationInput): SimulationDraft {
  const scenario: Scenario = {
    intervalSeconds: input.scenario.intervalSeconds,
    cadence: input.scenario.cadence,
    fields: Object.entries(input.scenario.fields).map(([name, spec]) => ({ name, spec })),
    primaryKey: input.scenario.table?.primaryKey,
    seedRows: input.scenario.seedRows,
    insertsPerTick: input.scenario.insertsPerTick,
    maxRows: input.scenario.maxRows,
  };
  return {
    name: input.name ?? "",
    description: input.description ?? "",
    ...(input.origin ? { origin: input.origin } : {}),
    enabled: input.enabled,
    transport: input.transport,
    scenario,
  };
}

export function toJson(draft: SimulationDraft): string {
  return JSON.stringify(toInput(draft), null, 2);
}

const KINDS = new Set(["constant", "now", "enum", "randomWalk", "dailyProfile", "sequence", "jitter"]);

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function fromJson(text: string): SimulationDraft {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new Error(`Kein gültiges JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!isObject(raw)) throw new Error("Die Konfiguration muss ein Objekt sein.");
  const transport = raw.transport;
  if (!isObject(transport)) throw new Error("„transport“ fehlt.");
  const scenario = raw.scenario;
  if (!isObject(scenario)) throw new Error("„scenario“ fehlt.");
  const fieldsRaw = scenario.fields;
  if (!isObject(fieldsRaw)) throw new Error("„scenario.fields“ muss ein Objekt (Feldname → Generator) sein.");

  const fields = Object.entries(fieldsRaw).map(([name, spec]) => {
    if (!isObject(spec) || typeof spec.kind !== "string" || !KINDS.has(spec.kind)) {
      throw new Error(`Feld „${name}“: unbekannter Generator. Erlaubt: ${[...KINDS].join(", ")}.`);
    }
    return { name, spec: spec as unknown as GeneratorSpec };
  });

  let parsedTransport: Transport;
  if (transport.kind === "sql") {
    if (typeof transport.table !== "string") throw new Error("SQL: „transport.table“ fehlt.");
    parsedTransport = { kind: "sql", table: transport.table };
  } else if (transport.kind === "mqtt" || transport.kind === undefined) {
    if (typeof transport.url !== "string" || typeof transport.topic !== "string") {
      throw new Error("MQTT: „transport.url“ und „transport.topic“ werden gebraucht.");
    }
    parsedTransport = { kind: "mqtt", url: transport.url, topic: transport.topic };
  } else {
    throw new Error(`Unbekannter Transport „${String(transport.kind)}“ (mqtt oder sql).`);
  }

  const table = isObject(scenario.table) ? scenario.table : undefined;
  const num = (v: unknown) => (typeof v === "number" ? v : undefined);

  return {
    name: typeof raw.name === "string" ? raw.name : "",
    description: typeof raw.description === "string" ? raw.description : "",
    // Checked by the service on save; here it only has to survive the round trip.
    ...(isObject(raw.origin) ? { origin: raw.origin as Origin } : {}),
    enabled: raw.enabled !== false,
    transport: parsedTransport,
    scenario: {
      intervalSeconds: num(scenario.intervalSeconds) ?? 10,
      cadence: scenario.cadence === "fillToLimit" ? "fillToLimit" : undefined,
      fields,
      primaryKey: table && typeof table.primaryKey === "string" ? table.primaryKey : undefined,
      seedRows: num(scenario.seedRows),
      insertsPerTick: num(scenario.insertsPerTick),
      maxRows: num(scenario.maxRows),
    },
  };
}
