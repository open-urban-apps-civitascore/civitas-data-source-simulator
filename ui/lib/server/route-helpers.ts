import "server-only";

import { NextResponse } from "next/server";

import { GeneratorError } from "@/lib/server/generator";
import { isAuthorised } from "@/lib/server/session";
import { slugify } from "@/lib/slug";

/** 401 unless signed in. */
export async function requireSession(): Promise<NextResponse | null> {
  if (await isAuthorised()) return null;
  return NextResponse.json({ error: "Nicht angemeldet." }, { status: 401 });
}

/** Passes the service's own status through. */
export function toErrorResponse(error: unknown): NextResponse {
  if (error instanceof GeneratorError) {
    return NextResponse.json({ error: error.message, details: error.details }, { status: error.status });
  }
  console.error("[simulator-ui]", error);
  return NextResponse.json(
    { error: error instanceof Error ? error.message : String(error) },
    { status: 500 },
  );
}

/** `Verkehrszählung Hauptstraße` becomes `verkehrszaehlung-hauptstrasse-a1b2`. */
export function mintId(name: string): string {
  return `${slugify(name, 40) || "simulation"}-${Math.random().toString(16).slice(2, 6)}`;
}
