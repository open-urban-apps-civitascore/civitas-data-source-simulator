// Descriptions only. Values come from the service's own /sample endpoint, so
// the maths exists once.

import type { ColumnType, GeneratorSpec } from "./types";

export const COLUMN_TYPE_LABEL: Record<ColumnType, string> = {
  text: "Text",
  integer: "Ganzzahl",
  double: "Dezimalzahl",
  boolean: "Ja/Nein",
  timestamptz: "Zeitstempel",
};

export function derivedType(spec: GeneratorSpec): ColumnType {
  switch (spec.kind) {
    case "now":
      return "timestamptz";
    case "sequence":
      return "text";
    case "jitter":
      return "double";
    case "randomWalk":
    case "dailyProfile":
      return spec.integer ? "integer" : "double";
    case "constant":
      return typeof spec.value === "number"
        ? Number.isInteger(spec.value)
          ? "integer"
          : "double"
        : typeof spec.value === "boolean"
          ? "boolean"
          : "text";
    case "enum": {
      const first = spec.values[0];
      return typeof first === "number" ? "double" : typeof first === "boolean" ? "boolean" : "text";
    }
  }
}

export function describeSpec(spec: GeneratorSpec): string {
  switch (spec.kind) {
    case "constant":
      return `immer ${JSON.stringify(spec.value)}`;
    case "now":
      return "Sendezeitpunkt";
    case "enum":
      return `einer von ${spec.values.map((v) => JSON.stringify(v)).join(", ")}`;
    case "randomWalk":
      return `${spec.min} – ${spec.max}, max. ±${spec.step} pro Tick${spec.integer ? ", ganzzahlig" : ""}`;
    case "dailyProfile":
      return `${spec.min} – ${spec.max}, Spitzen um ${spec.peakHours.map((h) => `${h}:00`).join(" und ")}`;
    case "sequence": {
      const start = spec.start ?? 1;
      const pad = spec.padTo ?? 0;
      const prefix = spec.prefix ?? "";
      return `${prefix}${String(start).padStart(pad, "0")}, ${prefix}${String(start + 1).padStart(pad, "0")}, …`;
    }
    case "jitter":
      return `${spec.center} ± ${spec.spread}`;
  }
}

export function defaultSpec(kind: GeneratorSpec["kind"]): GeneratorSpec {
  switch (kind) {
    case "constant":
      return { kind, value: "" };
    case "now":
      return { kind };
    case "enum":
      return { kind, values: ["A", "B"] };
    case "randomWalk":
      return { kind, min: 0, max: 100, step: 5, integer: false };
    case "dailyProfile":
      return { kind, min: 0, max: 100, peakHours: [8, 17], noise: 0.1, integer: false };
    case "sequence":
      return { kind, prefix: "", start: 1, padTo: 0 };
    case "jitter":
      return { kind, center: 0, spread: 0.001, precision: 6 };
  }
}
