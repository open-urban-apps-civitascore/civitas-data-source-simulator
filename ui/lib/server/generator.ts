import "server-only";

import { getAccessToken } from "@/lib/server/session";
import type {
  SimulationDetail,
  SimulationInput,
  SimulationStatus,
  WireScenario,
} from "@/lib/types";

const BASE_URL = (process.env.GENERATOR_BASE_URL ?? "http://localhost:4300").replace(/\/$/, "");
/** The simulator is in the same cluster; a slow reply means it is in trouble. */
const TIMEOUT_MS = 5000;

export class GeneratorError extends Error {
  readonly status: number;
  readonly details: unknown;

  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  // The signed-in person's own token, so the simulator sees who is acting
  // rather than just that something asked. Null while auth is disabled, and
  // null when this instance has no Keycloak; the simulator then decides
  // whether it minds, which keeps local development working.
  const accessToken = await getAccessToken();

  let response: Response;
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        ...(init?.headers ?? {}),
      },
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    // A refused connection is the normal case; do not leak a fetch stack trace.
    throw new GeneratorError(
      503,
      `Der Generator ist unter ${BASE_URL} nicht erreichbar.`,
      error instanceof Error ? error.message : String(error),
    );
  }

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  const body = parseJson(text);

  if (!response.ok) {
    throw new GeneratorError(
      response.status,
      typeof body?.error === "string" ? body.error : describeUnparsable(response.status, text),
      body?.details,
    );
  }
  if (body === null) {
    throw new GeneratorError(502, "Der Generator hat keine verwertbare Antwort geschickt.");
  }
  return body as T;
}

function parseJson(text: string): Record<string, unknown> | null {
  if (!text.trim()) return {};
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    // An unhandled route error makes Express answer with an HTML page. Reading
    // that as JSON used to surface a parser complaint instead of the real cause.
    return null;
  }
}

function describeUnparsable(status: number, text: string): string {
  const html = /^\s*<(!doctype|html)/i.test(text);
  return html
    ? `Der Generator hat mit einer Fehlerseite geantwortet (Status ${status}). Die Ursache steht im Log des Generators.`
    : `Der Generator antwortete mit ${status}.`;
}

/** Empty when the generator has no broker configured or cannot be asked. */
export async function getDefaultBrokerUrl(): Promise<string> {
  try {
    return (await call<{ brokerUrl: string | null }>("/defaults")).brokerUrl ?? "";
  } catch {
    return "";
  }
}

export async function listSimulations(): Promise<SimulationStatus[]> {
  const body = await call<{ simulations: SimulationStatus[] }>("/simulations");
  return body.simulations;
}

export async function getSimulation(id: string): Promise<SimulationDetail | null> {
  try {
    return await call<SimulationDetail>(`/simulations/${encodeURIComponent(id)}`);
  } catch (error) {
    if (error instanceof GeneratorError && error.status === 404) return null;
    throw error;
  }
}

export async function putSimulation(id: string, input: SimulationInput): Promise<SimulationStatus> {
  return call<SimulationStatus>(`/simulations/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export async function deleteSimulation(id: string): Promise<void> {
  await call<void>(`/simulations/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function setEnabled(id: string, enabled: boolean): Promise<SimulationStatus> {
  return call<SimulationStatus>(
    `/simulations/${encodeURIComponent(id)}/${enabled ? "switch_on" : "switch_off"}`,
    { method: "POST" },
  );
}

/** Render a scenario without registering it. */
export async function sampleScenario(
  scenario: WireScenario,
  count = 3,
): Promise<Record<string, unknown>[]> {
  const body = await call<{ records: Record<string, unknown>[] }>("/sample", {
    method: "POST",
    body: JSON.stringify({ scenario, count }),
  });
  return body.records;
}

export async function generatorHealth(): Promise<{ status: string; simulations: number } | null> {
  try {
    return await call<{ status: string; simulations: number }>("/healthz");
  } catch {
    return null;
  }
}
