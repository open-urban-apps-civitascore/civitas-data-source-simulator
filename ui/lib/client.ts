// Everything goes through this app's own /api routes, never to the generator
// directly: the address stays server-side, and there is one place for a token.

import type { SimulationDetail, SimulationInput, SimulationStatus, WireScenario } from "./types";

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  // Never assume JSON: a crashed route answers with an HTML page, and parsing
  // that would replace the real cause with a parser complaint.
  let body: Record<string, unknown> | null = {};
  if (text.trim()) {
    try {
      body = JSON.parse(text) as Record<string, unknown>;
    } catch {
      body = null;
    }
  }
  if (!response.ok) {
    throw new Error(
      typeof body?.error === "string" ? body.error : `Der Generator antwortete mit ${response.status}.`,
    );
  }
  if (body === null) throw new Error("Keine verwertbare Antwort erhalten.");
  return body as T;
}

export async function fetchSimulations(): Promise<SimulationStatus[]> {
  const body = await call<{ simulations: SimulationStatus[] }>("/api/simulations");
  return body.simulations;
}

export function fetchSimulation(id: string): Promise<SimulationDetail> {
  return call<SimulationDetail>(`/api/simulations/${encodeURIComponent(id)}`);
}

export function createSimulation(input: SimulationInput): Promise<SimulationStatus> {
  return call<SimulationStatus>("/api/simulations", { method: "POST", body: JSON.stringify(input) });
}

export function saveSimulation(id: string, input: SimulationInput): Promise<SimulationStatus> {
  return call<SimulationStatus>(`/api/simulations/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export function removeSimulation(id: string): Promise<void> {
  return call<void>(`/api/simulations/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export function switchSimulation(id: string, enabled: boolean): Promise<SimulationStatus> {
  return call<SimulationStatus>(`/api/simulations/${encodeURIComponent(id)}/switch`, {
    method: "POST",
    body: JSON.stringify({ enabled }),
  });
}

export async function sampleScenario(scenario: WireScenario, count = 3): Promise<Record<string, unknown>[]> {
  const body = await call<{ records: Record<string, unknown>[] }>("/api/sample", {
    method: "POST",
    body: JSON.stringify({ scenario, count }),
  });
  return body.records;
}
