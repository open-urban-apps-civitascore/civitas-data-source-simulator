import type { ColumnType, TableSpec } from "./types.js";

export interface ResolvedTable {
  columns: Record<string, ColumnType>;
  primaryKey: string;
}

const PRIMARY_KEY_MARKER = "x-core-primaryKey";

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function derefClass(schema: unknown, pointer: string): Record<string, unknown> {
  if (!isObject(schema)) throw new Error("rowSchema must be a JSON Schema object.");
  if (pointer === "#") return schema;
  if (!pointer.startsWith("#/")) {
    throw new Error(`rowClass must be '#' or a '#/...' JSON pointer, got '${pointer}'.`);
  }

  let node: unknown = schema;
  for (const segment of pointer.slice(2).split("/")) {
    const key = segment.replace(/~1/g, "/").replace(/~0/g, "~");
    node = isObject(node) ? node[key] : undefined;
    if (node === undefined) throw new Error(`rowClass '${pointer}' does not resolve in rowSchema.`);
  }
  if (!isObject(node)) throw new Error(`rowClass '${pointer}' does not point at an object.`);
  return node;
}

export function columnTypeFor(property: unknown, name: string): ColumnType {
  if (!isObject(property)) throw new Error(`Column '${name}': not a schema object.`);
  if ("$ref" in property) {
    throw new Error(
      `Column '${name}': $ref cannot be resolved here — a source table holds plain values.`,
    );
  }

  const type = property.type;
  const format = property.format;
  if (type === "boolean") return "boolean";
  if (type === "integer") return "integer";
  if (type === "number") return "double";
  if (type === "string") return format === "date-time" ? "timestamptz" : "text";

  throw new Error(
    `Column '${name}': cannot map JSON Schema type '${String(type)}' to a column type.`,
  );
}

export function deriveTable(
  rowSchema: unknown,
  rowClass: string,
): { columns: Record<string, ColumnType>; primaryKey: string | null } {
  const node = derefClass(rowSchema, rowClass);
  const properties = node.properties;
  if (!isObject(properties)) {
    throw new Error(`rowClass '${rowClass}' declares no properties.`);
  }

  const columns: Record<string, ColumnType> = {};
  let primaryKey: string | null = null;

  for (const [name, property] of Object.entries(properties)) {
    if (name.includes(".")) {
      throw new Error(`Column '${name}': SQL column names cannot be dotted paths.`);
    }
    columns[name] = columnTypeFor(property, name);
    if (isObject(property) && property[PRIMARY_KEY_MARKER] === true) {
      if (primaryKey) {
        throw new Error(`Two properties are marked ${PRIMARY_KEY_MARKER}: '${primaryKey}' and '${name}'.`);
      }
      primaryKey = name;
    }
  }

  return { columns, primaryKey };
}

export function resolveTable(spec: TableSpec): ResolvedTable {
  const derived =
    spec.rowSchema === undefined
      ? { columns: {} as Record<string, ColumnType>, primaryKey: null as string | null }
      : deriveTable(spec.rowSchema, spec.rowClass);

  const columns: Record<string, ColumnType> = { ...derived.columns };
  for (const [name, type] of Object.entries(spec.columns)) {
    columns[name] = type;
  }

  if (Object.keys(columns).length === 0) {
    throw new Error("The table has no columns: send a rowSchema, or declare columns.");
  }

  const primaryKey = spec.primaryKey ?? derived.primaryKey;
  if (!primaryKey) {
    throw new Error(
      `No primary key: mark one property ${PRIMARY_KEY_MARKER} in the rowSchema, or set table.primaryKey.`,
    );
  }
  if (!(primaryKey in columns)) {
    throw new Error(`primaryKey '${primaryKey}' is not one of the columns.`);
  }

  return { columns, primaryKey };
}
