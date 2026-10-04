import type { Origin } from "./types";

/** One artifact: equal URNs, or one is the other's versioned form (`…:1.0.0`). */
export function sameUrn(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  return a === b || a.startsWith(`${b}:`) || b.startsWith(`${a}:`);
}

/**
 * Whether a simulation feeds this portal data structure. By id when the
 * simulation knows its origin. By the structure's name in the description only
 * for registrations from before the origin, which carried nothing else.
 */
export function feedsDataStructure(
  sim: { origin?: Origin | null; description: string | null },
  ds: { urn: string; name: string },
): boolean {
  const structure = sim.origin?.dataStructure;
  if (structure?.urn) return sameUrn(structure.urn, ds.urn);
  if (structure) return structure.name === ds.name;
  return (sim.description ?? "").includes(ds.name);
}
