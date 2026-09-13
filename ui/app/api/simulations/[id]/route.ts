import { NextResponse } from "next/server";

import { deleteSimulation, getSimulation, putSimulation } from "@/lib/server/generator";
import { requireSession, toErrorResponse } from "@/lib/server/route-helpers";
import type { SimulationInput } from "@/lib/types";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireSession();
  if (denied) return denied;
  const { id } = await params;
  try {
    const simulation = await getSimulation(id);
    if (!simulation) return NextResponse.json({ error: "Unbekannte Simulation." }, { status: 404 });
    return NextResponse.json(simulation);
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireSession();
  if (denied) return denied;
  const { id } = await params;
  try {
    const input = (await request.json()) as SimulationInput;
    return NextResponse.json(await putSimulation(id, input));
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireSession();
  if (denied) return denied;
  const { id } = await params;
  try {
    await deleteSimulation(id);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
