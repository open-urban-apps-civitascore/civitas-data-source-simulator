import "server-only";

import { getAccessToken } from "@/lib/server/session";
import type { DataStructureProperty, PortalDataStructure } from "@/lib/types";

/**
 * Reads the instance's data structures from the portal backend, with the
 * signed-in person's token. Same endpoints the marketplace uses.
 *
 * Unset base URL means this instance has no portal to ask, and the page falls
 * back to the bundled examples rather than showing nothing.
 */
const BASE_URL = process.env.PORTAL_BACKEND_BASE_URL?.replace(/\/$/, "");
/** A demo instance has a handful; the bound stops a mistake becoming a stampede. */
const MAX_STRUCTURES = 50;
const TIMEOUT_MS = 8000;

export function portalConfigured(): boolean {
  return Boolean(BASE_URL);
}

export class PortalError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

interface Page<T> {
  content?: T[];
}

async function getJson<T>(path: string, token: string): Promise<T | undefined> {
  let response: Response;
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    throw new PortalError(
      `Das Portal ist unter ${BASE_URL} nicht erreichbar: ${error instanceof Error ? error.message : String(error)}`,
      0,
    );
  }
  if (response.status === 404) return undefined;
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { detail?: string } | null;
    throw new PortalError(body?.detail ?? `${path}: ${response.status}`, response.status);
  }
  return (await response.json()) as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * A CORE model puts its row class under `$defs`, usually as the only entry.
 * A model that carries properties at the root is taken as its own class.
 */
function rowClassOf(model: Record<string, unknown>): Record<string, unknown> | undefined {
  if (isRecord(model.properties)) return model;
  const defs = model.$defs;
  if (!isRecord(defs)) return undefined;
  const classes = Object.values(defs).filter(isRecord);
  return classes.find((candidate) => isRecord(candidate.properties));
}

/** Nested objects become dotted names, which is how the simulator names fields. */
function readProperties(
  cls: Record<string, unknown>,
  prefix = "",
): DataStructureProperty[] {
  const properties = isRecord(cls.properties) ? cls.properties : {};
  const required = Array.isArray(cls.required) ? cls.required.filter((r) => typeof r === "string") : [];
  const out: DataStructureProperty[] = [];

  for (const [name, raw] of Object.entries(properties)) {
    if (!isRecord(raw)) continue;
    const path = prefix ? `${prefix}.${name}` : name;

    if (isRecord(raw.properties)) {
      out.push(...readProperties(raw, path));
      continue;
    }

    // Every source the platform ingests today, MQTT or SQL, carries only flat
    // values: one plain field per column or JSON key, never a nested document
    // or a built geometry. A $ref (a merged geo point, most often) describes
    // something a mapping step produced downstream, not something a real
    // source ever sends — so there is no faithful field to offer here, and
    // guessing one would mislabel the simulation as matching a use case's
    // real wire format when it does not. Listed and left unmapped instead.
    const type = typeof raw.type === "string" ? raw.type : "$ref" in raw ? "unsupported" : "string";
    if (type !== "string" && type !== "number" && type !== "integer" && type !== "boolean") {
      out.push({
        name: path,
        type: "string",
        description:
          (typeof raw.description === "string" ? raw.description : "") ||
          "Kein Generator verfügbar: kein flaches Feld, wie MQTT oder SQL es heute brauchen.",
        required: required.includes(name),
        unsupported: true,
      });
      continue;
    }

    out.push({
      name: path,
      type,
      format: raw.format === "date-time" ? "date-time" : undefined,
      description: typeof raw.description === "string" ? raw.description : "",
      enum: Array.isArray(raw.enum) ? raw.enum.filter((v): v is string => typeof v === "string") : undefined,
      minimum: typeof raw.minimum === "number" ? raw.minimum : undefined,
      maximum: typeof raw.maximum === "number" ? raw.maximum : undefined,
      primaryKey: raw["x-core-primaryKey"] === true,
      required: required.includes(name),
    });
  }
  return out;
}

function currentVersionOf(
  structure: Record<string, unknown>,
): { id: string; version: string } | undefined {
  const versions = Array.isArray(structure.dataStructureVersions)
    ? structure.dataStructureVersions
    : [];
  let current: { id: string; version: string } | undefined;
  for (const candidate of versions) {
    if (!isRecord(candidate)) continue;
    const id = typeof candidate.id === "string" ? candidate.id : "";
    const version = typeof candidate.version === "string" ? candidate.version : "";
    if (!id || !version) continue;
    if (!current || version.localeCompare(current.version, undefined, { numeric: true }) > 0) {
      current = { id, version };
    }
  }
  return current;
}

/** `urn:core:standard:openurbanapps:datastructure:mobility:name:hash` */
function segmentsOf(urn: string): { domain: string; publisher: string } {
  const parts = urn.split(":");
  return {
    domain: parts.length > 6 ? parts[5] : "—",
    publisher: parts.length > 4 ? parts[3] : "—",
  };
}

export async function fetchPortalDataStructures(): Promise<PortalDataStructure[]> {
  if (!BASE_URL) return [];
  const token = await getAccessToken();
  if (!token) throw new PortalError("Kein Token: ohne Anmeldung liest das Portal nichts aus.", 401);

  const page = await getJson<Page<Record<string, unknown>>>(
    `/datastructures?size=${MAX_STRUCTURES}`,
    token,
  );
  const out: PortalDataStructure[] = [];

  for (const structure of page?.content ?? []) {
    const id = String(structure.id ?? "");
    if (!id) continue;
    const latest = currentVersionOf(structure);
    if (!latest) continue;

    const detail = await getJson<Record<string, unknown>>(
      `/datastructures/${id}/versions/${latest.id}`,
      token,
    );
    if (!detail || !isRecord(detail.model)) continue;

    const cls = rowClassOf(detail.model);
    if (!cls) continue;

    const urn = typeof detail.modelUrn === "string" ? detail.modelUrn : id;
    const { domain, publisher } = segmentsOf(urn);
    out.push({
      urn,
      name:
        (typeof structure.name === "string" && structure.name) ||
        (typeof detail.model.title === "string" && detail.model.title) ||
        id,
      version: latest.version,
      description:
        (typeof structure.description === "string" && structure.description) ||
        (typeof detail.model.description === "string" && detail.model.description) ||
        "",
      domain,
      publisher,
      usedBy: [],
      properties: readProperties(cls),
    });
  }
  return out;
}
