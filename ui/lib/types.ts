// Wire shapes of the control API, plus the draft the editor works with.
export type GeneratorSpec =
  | { kind: "constant"; value: string | number | boolean }
  | { kind: "now" }
  | { kind: "enum"; values: (string | number | boolean)[] }
  | { kind: "randomWalk"; min: number; max: number; step: number; start?: number; integer?: boolean }
  | { kind: "dailyProfile"; min: number; max: number; peakHours: number[]; noise?: number; integer?: boolean }
  | { kind: "sequence"; prefix?: string; start?: number; padTo?: number }
  | { kind: "jitter"; center: number; spread: number; precision?: number };

export type GeneratorKind = GeneratorSpec["kind"];

export const GENERATOR_KINDS: { kind: GeneratorKind; label: string; hint: string }[] = [
  { kind: "constant", label: "Fester Wert", hint: "Immer derselbe Wert, z. B. eine Sensor-ID." },
  { kind: "now", label: "Aktuelle Zeit", hint: "Zeitstempel des Sendezeitpunkts (ISO-8601)." },
  { kind: "enum", label: "Auswahl aus Liste", hint: "Zufällig einer der angegebenen Werte." },
  { kind: "randomWalk", label: "Zufallsdrift", hint: "Bewegt sich pro Tick höchstens um „Schritt“ – Messwerte wirken zusammenhängend." },
  { kind: "dailyProfile", label: "Tagesprofil", hint: "Folgt der Uhrzeit: nachts niedrig, Spitze zu den Stoßzeiten." },
  { kind: "sequence", label: "Laufende Nummer", hint: "Präfix + Zähler – der einzige Generator, der eindeutige Schlüssel liefert." },
  { kind: "jitter", label: "Streuung um Punkt", hint: "Streut um einen Mittelpunkt, ohne zu wandern – richtig für Koordinaten." },
];

export type ColumnType = "text" | "integer" | "double" | "boolean" | "timestamptz";

export type MqttTransport = { kind: "mqtt"; url: string; topic: string };
export type SqlTransport = { kind: "sql"; table: string; dsn?: string; readDsn?: string };
export type Transport = MqttTransport | SqlTransport;

/** `fillToLimit`: SQL only. The table is filled to `maxRows` at start, nothing follows. */
export type Cadence = "interval" | "fillToLimit";

/** Fields are a map of dotted path to generator. */
export interface WireScenario {
  intervalSeconds: number;
  cadence?: Cadence;
  fields: Record<string, GeneratorSpec>;
  table?: { rowSchema?: unknown; rowClass?: string; columns?: Record<string, ColumnType>; primaryKey?: string };
  seedRows?: number;
  insertsPerTick?: number;
  maxRows?: number;
  timeCompression?: string;
}

/** A portal artifact: the name shown there, and the ids that find it. */
export interface ArtifactRef {
  name: string;
  /** Logical CORE URN; a versioned form of it names the same artifact. */
  urn?: string;
  /** The portal's own id. */
  id?: string;
}

/** What a simulation belongs to on the platform. The marketplace sends it; a snapshot. */
export interface Origin {
  installationId?: string;
  useCase?: { id: string; name: string; version?: string };
  dataSet?: ArtifactRef;
  dataSource?: ArtifactRef;
  dataStructure?: ArtifactRef;
  /** The stream's name in the package. */
  stream?: string;
}

export interface SimulationInput {
  name?: string;
  description?: string;
  origin?: Origin;
  enabled: boolean;
  transport: Transport;
  scenario: WireScenario;
}

export interface SimulationStatus {
  id: string;
  name: string | null;
  description: string | null;
  /** Absent from services older than the origin; null for a simulation made by hand. */
  origin?: Origin | null;
  enabled: boolean;
  transport: "mqtt" | "sql";
  topic: string | null;
  target: string;
  intervalSeconds: number;
  /** Absent from services older than the cadence. */
  cadence?: Cadence;
  createdAt: string;
  publishedCount: number;
  rowCount: number | null;
  maxRows: number | null;
  atCap: boolean;
  lastPublishedAt: string | null;
  lastPayload: Record<string, unknown> | null;
  lastError: string | null;
}

/** The detail route adds the configuration it was built from. */
export interface SimulationDetail extends SimulationStatus {
  input: SimulationInput | null;
}

/** Ordered form of the field map, so the editor keeps row order. */
export interface FieldSpec {
  name: string;
  spec: GeneratorSpec;
}

export interface Scenario {
  intervalSeconds: number;
  cadence?: Cadence;
  fields: FieldSpec[];
  primaryKey?: string;
  seedRows?: number;
  insertsPerTick?: number;
  maxRows?: number;
}

export interface SimulationDraft {
  name: string;
  description: string;
  /** Not edited here, only carried through: a save must not cut the link to the portal. */
  origin?: Origin;
  enabled: boolean;
  transport: Transport;
  scenario: Scenario;
}

export interface StreamEvent {
  seq: number;
  at: string;
  payload: Record<string, unknown>;
}

export interface DataStructureProperty {
  name: string;
  type: "string" | "number" | "integer" | "boolean";
  format?: "date-time";
  description: string;
  enum?: string[];
  minimum?: number;
  maximum?: number;
  primaryKey?: boolean;
  required: boolean;
  unsupported?: boolean;
}

export interface PortalDataStructure {
  urn: string;
  name: string;
  version: string;
  description: string;
  domain: string;
  publisher: string;
  usedBy: string[];
  properties: DataStructureProperty[];
}
