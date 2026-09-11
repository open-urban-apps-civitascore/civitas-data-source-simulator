import { describe, expect, it } from "vitest";

import { columnTypeFor, derefClass, deriveTable, resolveTable } from "./row-schema.js";
import { simulationInputSchema } from "./types.js";

/** A copy of the structure the Kiez-Baumkataster package ships (baumkataster-zeile). */
const BAUMKATASTER = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "Baumkataster-Zeile (Rohformat)",
  $defs: {
    BaumkatasterZeile: {
      type: "object",
      properties: {
        baum_id: { type: "string", description: "Eindeutige Kataster-Nummer" },
        gattung: { type: "string" },
        art_deutsch: { type: "string" },
        pflanzjahr: { type: "integer" },
        kronendurchmesser_m: { type: "number" },
        stammumfang_cm: { type: "number" },
        standort: { type: "string" },
        lon: { type: "number" },
        lat: { type: "number" },
      },
      required: ["baum_id", "lon", "lat"],
    },
  },
};

describe("deriving a table from the package's own row structure", () => {
  it("produces every column with the right type", () => {
    const { columns } = deriveTable(BAUMKATASTER, "#/$defs/BaumkatasterZeile");
    expect(columns).toEqual({
      baum_id: "text",
      gattung: "text",
      art_deutsch: "text",
      pflanzjahr: "integer",
      kronendurchmesser_m: "double",
      stammumfang_cm: "double",
      standort: "text",
      lon: "double",
      lat: "double",
    });
  });

  it("finds no primary key, because the shipped structure marks none", () => {
    // The marker exists in CIVITAS on TARGET structures; the source row has it nowhere,
    // which is why primaryKey still has to be named by hand today.
    expect(deriveTable(BAUMKATASTER, "#/$defs/BaumkatasterZeile").primaryKey).toBeNull();
  });

  it("uses x-core-primaryKey when the structure does carry it", () => {
    const marked = {
      type: "object",
      properties: { baum_id: { type: "string", "x-core-primaryKey": true }, lon: { type: "number" } },
    };
    expect(deriveTable(marked, "#").primaryKey).toBe("baum_id");
  });
});

describe("type mapping", () => {
  it("maps the five shapes a source row can hold", () => {
    expect(columnTypeFor({ type: "string" }, "a")).toBe("text");
    expect(columnTypeFor({ type: "string", format: "date-time" }, "a")).toBe("timestamptz");
    expect(columnTypeFor({ type: "integer" }, "a")).toBe("integer");
    expect(columnTypeFor({ type: "number" }, "a")).toBe("double");
    expect(columnTypeFor({ type: "boolean" }, "a")).toBe("boolean");
  });

  it("refuses geometry rather than guessing — the map shape is built at the far end", () => {
    expect(() => columnTypeFor({ $ref: "https://geojson.org/schema/Point.json" }, "position")).toThrow(
      /\$ref cannot be resolved/,
    );
  });

  it("names the column it cannot map", () => {
    expect(() => columnTypeFor({ type: "array" }, "tags")).toThrow(/'tags'/);
  });
});

describe("rowClass pointers", () => {
  it("takes '#' as the root and walks a '#/...' path", () => {
    expect(derefClass({ type: "object" }, "#")).toEqual({ type: "object" });
    expect(derefClass(BAUMKATASTER, "#/$defs/BaumkatasterZeile")).toHaveProperty("properties");
  });

  it("says so when the pointer leads nowhere", () => {
    expect(() => derefClass(BAUMKATASTER, "#/$defs/Nope")).toThrow(/does not resolve/);
  });
});

describe("resolveTable", () => {
  const spec = {
    rowSchema: BAUMKATASTER,
    rowClass: "#/$defs/BaumkatasterZeile",
    columns: {},
    primaryKey: "baum_id",
  };

  it("derives the columns and takes the key that was named", () => {
    const resolved = resolveTable(spec as never);
    expect(Object.keys(resolved.columns)).toHaveLength(9);
    expect(resolved.primaryKey).toBe("baum_id");
  });

  it("lets an explicit column override a derived one", () => {
    // A schema says 'number'; an author who needs a whole year can say so.
    const resolved = resolveTable({ ...spec, columns: { pflanzjahr: "text" } } as never);
    expect(resolved.columns.pflanzjahr).toBe("text");
    expect(resolved.columns.lon).toBe("double");
  });

  it("still works with no schema at all, from an explicit list", () => {
    const resolved = resolveTable({
      rowClass: "#",
      columns: { id: "text", v: "double" },
      primaryKey: "id",
    } as never);
    expect(resolved).toEqual({ columns: { id: "text", v: "double" }, primaryKey: "id" });
  });

  it("refuses when no key is marked and none is named", () => {
    expect(() => resolveTable({ ...spec, primaryKey: undefined } as never)).toThrow(/No primary key/);
  });

  it("refuses a key that is not a column", () => {
    expect(() => resolveTable({ ...spec, primaryKey: "nope" } as never)).toThrow(/not one of the columns/);
  });
});

describe("a whole request described by schema instead of columns", () => {
  it("validates, and its fields are checked against the DERIVED columns", () => {
    const input = {
      transport: { kind: "sql", table: "kataster.kiez_baeume" },
      scenario: {
        maxRows: 60,
        table: { rowSchema: BAUMKATASTER, rowClass: "#/$defs/BaumkatasterZeile", primaryKey: "baum_id" },
        fields: {
          baum_id: { kind: "sequence", prefix: "KB-" },
          gattung: { kind: "constant", value: "Tilia" },
          art_deutsch: { kind: "constant", value: "Winterlinde" },
          pflanzjahr: { kind: "randomWalk", min: 1955, max: 1975, step: 3, integer: true },
          kronendurchmesser_m: { kind: "randomWalk", min: 8, max: 18, step: 1.5 },
          stammumfang_cm: { kind: "randomWalk", min: 150, max: 340, step: 20 },
          standort: { kind: "constant", value: "Lindenweg" },
          lon: { kind: "jitter", center: 7.6362, spread: 0.0008 },
          lat: { kind: "jitter", center: 51.9561, spread: 0.0004 },
        },
      },
    };
    expect(simulationInputSchema.safeParse(input).success).toBe(true);
  });

  it("still catches a field the derived table has no column for", () => {
    const input = {
      transport: { kind: "sql", table: "k.t" },
      scenario: {
        maxRows: 10,
        table: { rowSchema: BAUMKATASTER, rowClass: "#/$defs/BaumkatasterZeile", primaryKey: "baum_id" },
        fields: { baum_id: { kind: "sequence" }, zustand: { kind: "constant", value: "gut" } },
      },
    };
    expect(simulationInputSchema.safeParse(input).success).toBe(false);
  });
});
