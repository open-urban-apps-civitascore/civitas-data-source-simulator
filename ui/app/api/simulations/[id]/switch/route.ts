import { NextResponse } from "next/server";

import { setEnabled } from "@/lib/server/generator";
import { requireSession, toErrorResponse } from "@/lib/server/route-helpers";

export const runtime = "nodejs";

/** Both switch_on and switch_off, chosen by the body. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireSession();
  if (denied) return denied;
  const { id } = await params;
  try {
    const body = (await request.json().catch(() => ({}))) as { enabled?: boolean };
    return NextResponse.json(await setEnabled(id, body.enabled !== false));
  } catch (error) {
    return toErrorResponse(error);
  }
}
