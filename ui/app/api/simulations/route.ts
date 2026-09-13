import { NextResponse } from "next/server";

import { listSimulations, putSimulation } from "@/lib/server/generator";
import { mintId, requireSession, toErrorResponse } from "@/lib/server/route-helpers";
import type { SimulationInput } from "@/lib/types";

export const runtime = "nodejs";

export async function GET() {
  const denied = await requireSession();
  if (denied) return denied;
  try {
    return NextResponse.json({ simulations: await listSimulations() });
  } catch (error) {
    return toErrorResponse(error);
  }
}

/** The service has no POST: the caller owns the id, so the UI mints one. */
export async function POST(request: Request) {
  const denied = await requireSession();
  if (denied) return denied;
  try {
    const input = (await request.json()) as SimulationInput;
    const id = mintId(input.name ?? "");
    return NextResponse.json(await putSimulation(id, input), { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
