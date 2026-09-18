import "server-only";

import { PORTAL_DATA_STRUCTURES } from "@/lib/portal-datastructures";
import { fetchPortalDataStructures, PortalError, portalConfigured } from "@/lib/server/portal";
import type { PortalDataStructure } from "@/lib/types";

export type StructureSource = "portal" | "examples";

export interface StructureResult {
  structures: PortalDataStructure[];
  source: StructureSource;
  /** Why the portal was not used, when it was not. */
  notice: string | null;
}

/**
 * The instance's data structures, read from the portal. Falls back to the
 * bundled examples when there is no portal to ask or it cannot be reached, and
 * always says which of the two the page is showing — a page that silently
 * shows examples as if they were real would be worse than an error.
 */
export async function getDataStructures(): Promise<StructureResult> {
  if (!portalConfigured()) {
    return {
      structures: PORTAL_DATA_STRUCTURES,
      source: "examples",
      notice: "Kein Portal konfiguriert (PORTAL_BACKEND_BASE_URL). Gezeigt werden Beispiele.",
    };
  }
  try {
    const structures = await fetchPortalDataStructures();
    if (structures.length === 0) {
      return { structures, source: "portal", notice: null };
    }
    return { structures, source: "portal", notice: null };
  } catch (error) {
    const detail = error instanceof PortalError ? error.message : String(error);
    return {
      structures: PORTAL_DATA_STRUCTURES,
      source: "examples",
      notice: `Portal nicht gelesen: ${detail} Gezeigt werden Beispiele.`,
    };
  }
}

export async function findDataStructure(urn?: string): Promise<PortalDataStructure | undefined> {
  if (!urn) return undefined;
  const { structures } = await getDataStructures();
  return structures.find((s) => s.urn === urn);
}
