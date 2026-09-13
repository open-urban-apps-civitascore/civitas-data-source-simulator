import { NextResponse } from "next/server";

import { sampleScenario } from "@/lib/server/generator";
import { requireSession, toErrorResponse } from "@/lib/server/route-helpers";
import type { WireScenario } from "@/lib/types";

export const runtime = "nodejs";

/** The editor's preview. Rendered, never published. */
export async function POST(request: Request) {
  const denied = await requireSession();
  if (denied) return denied;
  try {
    const body = (await request.json()) as { scenario: WireScenario; count?: number };
    return NextResponse.json({ records: await sampleScenario(body.scenario, body.count ?? 3) });
  } catch (error) {
    return toErrorResponse(error);
  }
}
