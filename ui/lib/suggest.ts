// One generator per property of a portal data structure. Every pick is a
// suggestion the user reviews in the editor.
import { slugify, topicFor } from "./slug";
import type { DataStructureProperty, FieldSpec, GeneratorSpec, PortalDataStructure, SimulationDraft } from "./types";

const MUSTERHAUSEN = { lat: 49.7913, lon: 9.9534 };

function suggestSpec(p: DataStructureProperty): GeneratorSpec {
  const lower = p.name.toLowerCase();
  if (p.primaryKey) return { kind: "sequence", prefix: `${p.name.replace(/_?id$/i, "") || "row"}-`, start: 1, padTo: 4 };
  if (p.format === "date-time") return { kind: "now" };
  if (p.enum && p.enum.length > 0) return { kind: "enum", values: p.enum };
  if (p.type === "boolean") return { kind: "enum", values: [true, false] };
  if (/lat(itude)?$/.test(lower)) return { kind: "jitter", center: MUSTERHAUSEN.lat, spread: 0.004, precision: 6 };
  if (/lon(gitude)?$/.test(lower)) return { kind: "jitter", center: MUSTERHAUSEN.lon, spread: 0.006, precision: 6 };
  if (p.type === "string") return { kind: "constant", value: `${p.name}-001` };

  const min = p.minimum ?? 0;
  const max = p.maximum ?? 100;
  const integer = p.type === "integer";
  // Counts and loads follow the clock; everything else drifts.
  if (/count|anzahl|power|load|leistung/.test(lower)) {
    return { kind: "dailyProfile", min, max: Math.round(max * 0.4), peakHours: [8, 17], noise: 0.15, integer };
  }
  const span = max - min;
  return { kind: "randomWalk", min, max, step: Math.max(span / 40, integer ? 1 : 0.1), start: min + span / 2, integer };
}

export function draftFromDataStructure(ds: PortalDataStructure, brokerUrl: string): SimulationDraft {
  // A property with no possible generator is left out: a field that cannot be
  // produced would be rejected by the service, or silently always null.
  const fields: FieldSpec[] = ds.properties
    .filter((p) => !p.unsupported)
    .map((p) => ({ name: p.name, spec: suggestSpec(p) }));
  const primaryKey = ds.properties.find((p) => p.primaryKey)?.name;
  const isTable = Boolean(primaryKey);
  const name = `${ds.name} (Simulation)`;
  return {
    name,
    description: `Aus der Portal-Datenstruktur ${ds.name} ${ds.version} abgeleitet.`,
    // Ties it to the structure by id, as an installed stream is tied by the marketplace.
    origin: { dataStructure: { name: ds.name, urn: ds.urn } },
    enabled: false,
    transport: isTable
      ? { kind: "sql", table: `${ds.domain.toLowerCase()}.${slugify(ds.name).replace(/-/g, "_")}` }
      : { kind: "mqtt", url: brokerUrl, topic: topicFor(name) },
    scenario: {
      intervalSeconds: isTable ? 60 : 10,
      fields,
      ...(isTable ? { primaryKey, seedRows: 100, insertsPerTick: 1, maxRows: 5000 } : {}),
    },
  };
}

/** The part of a portal data source a binding needs (lib/server/portal.ts reads it). */
export interface BindableSource {
  id: string;
  name: string;
  urn?: string;
  kind: "mqtt" | "sql" | "other";
  topics: string[];
  table?: string;
}

/**
 * Ties a draft to the data source it is meant to feed: the stream publishes
 * where the source listens (a subtopic under a `+` or `#` subscription, the
 * topic itself otherwise) or fills the table it reads, and the origin records
 * the source. That record is how the marketplace finds the stream again when
 * the use case is shared, and how a person reads where it belongs.
 */
export function bindToDataSource(draft: SimulationDraft, source: BindableSource): SimulationDraft {
  const name = `${source.name} (Simulation)`;
  const origin = { ...draft.origin, dataSource: { name: source.name, id: source.id, ...(source.urn ? { urn: source.urn } : {}) } };
  if (source.kind === "sql" && source.table) {
    return {
      ...draft,
      name,
      origin,
      transport: { kind: "sql", table: source.table },
      scenario: { seedRows: 100, insertsPerTick: 1, maxRows: 5000, ...draft.scenario, intervalSeconds: draft.scenario.intervalSeconds || 60 },
    };
  }
  const subscription = source.topics[0];
  if (source.kind === "mqtt" && subscription) {
    const wildcard = subscription.endsWith("/+") || subscription.endsWith("/#");
    const topic = wildcard ? `${subscription.slice(0, -2)}/${slugify(source.name)}` : subscription;
    const url = draft.transport.kind === "mqtt" ? draft.transport.url : "";
    return { ...draft, name, origin, transport: { kind: "mqtt", url, topic } };
  }
  return { ...draft, origin };
}
