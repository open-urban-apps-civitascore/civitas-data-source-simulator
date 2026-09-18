"use client";

import Link from "next/link";
import { useState } from "react";
import { AlertTriangle, ChevronDown, ChevronRight, Key, Plus } from "lucide-react";

import { PageBody } from "@/components/layout/page-body";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { DataStructureProperty, PortalDataStructure, SimulationStatus } from "@/lib/types";

const TYPE_LABEL: Record<string, string> = {
  string: "Text",
  number: "Dezimalzahl",
  integer: "Ganzzahl",
  boolean: "Ja/Nein",
};

function typeOf(p: DataStructureProperty): string {
  if (p.format === "date-time") return "Zeitstempel";
  if (p.enum) return `Auswahl (${p.enum.length})`;
  return TYPE_LABEL[p.type];
}

export function DataStructureList({
  structures,
  source,
  notice,
  simulations,
}: {
  structures: PortalDataStructure[];
  source: "portal" | "examples";
  notice: string | null;
  simulations: SimulationStatus[];
}) {
  const [open, setOpen] = useState<string | null>(null);

  return (
    <PageBody>
        <div className="mb-4">
          <h1>Datenstrukturen aus dem Portal</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            {source === "portal"
              ? "Die Datenstrukturen dieser CIVITAS/CORE-Instanz, gelesen aus dem Portal. "
              : "Mitgelieferte Beispiele, nicht die Strukturen dieser Instanz. "}
            Aus jeder lässt sich mit einem Klick eine passende Simulation ableiten: pro Eigenschaft
            ein Generator-Vorschlag, den du im Editor anpasst.
          </p>
        </div>

        {notice ? (
          <div className="mb-4 flex items-start gap-2 rounded-md border border-warn/40 bg-warn/20 px-3 py-2 text-sm">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <span>{notice}</span>
          </div>
        ) : null}

        {structures.length === 0 ? (
          <p className="rounded-md border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">
            Diese Instanz hat noch keine Datenstrukturen. Installiere einen Use Case im Marktplatz,
            dann erscheinen sie hier.
          </p>
        ) : null}

        <div className="grid gap-3">
          {structures.map((ds) => {
            const expanded = open === ds.urn;
            const sims = simulations.filter((s) => (s.description ?? "").includes(ds.name));
            return (
              <div key={ds.urn} className="rounded-lg border bg-card shadow-xs">
                <div className="flex items-start gap-3 px-4 py-3">
                  <button
                    type="button"
                    onClick={() => setOpen(expanded ? null : ds.urn)}
                    aria-expanded={expanded}
                    className="mt-0.5 text-muted-foreground hover:text-foreground"
                    aria-label={expanded ? "Zuklappen" : "Aufklappen"}
                  >
                    {expanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                  </button>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <button type="button" onClick={() => setOpen(expanded ? null : ds.urn)} className="font-medium hover:underline">
                        {ds.name}
                      </button>
                      <Badge variant="outline">{ds.version}</Badge>
                      <Badge variant="muted">{ds.domain}</Badge>
                      {ds.usedBy.length > 0 ? (
                        <span className="text-xs text-muted-foreground">genutzt von {ds.usedBy.join(", ")}</span>
                      ) : (
                        <span className="text-xs text-muted-foreground">nur als Baustein eingebettet</span>
                      )}
                    </div>
                    <p className="mt-0.5 text-sm text-muted-foreground">{ds.description}</p>
                    <p className="mt-1 truncate font-mono text-[11px] text-muted-foreground">{ds.urn}</p>
                    {sims.length > 0 ? (
                      <p className="mt-1 text-xs text-muted-foreground">
                        Simulationen:{" "}
                        {sims.map((s, i) => (
                          <span key={s.id}>
                            {i > 0 ? ", " : ""}
                            <Link href={`/simulations/${s.id}`} className="underline">
                              {s.name}
                            </Link>
                          </span>
                        ))}
                      </p>
                    ) : null}
                  </div>
                  <Button size="sm" asChild className="shrink-0">
                    <Link href={`/simulations/new?from=${encodeURIComponent(ds.urn)}`}>
                      <Plus /> Simulation anlegen
                    </Link>
                  </Button>
                </div>
                {expanded ? (
                  <div className="overflow-x-auto border-t">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
                        <tr>
                          <th className="px-4 py-2 font-medium">Eigenschaft</th>
                          <th className="px-4 py-2 font-medium">Typ</th>
                          <th className="px-4 py-2 font-medium">Bereich / Werte</th>
                          <th className="px-4 py-2 font-medium">Beschreibung</th>
                          <th className="px-4 py-2 font-medium">Pflicht</th>
                        </tr>
                      </thead>
                      <tbody>
                        {ds.properties.map((p) => (
                          <tr key={p.name} className="border-t">
                            <td className="px-4 py-2 font-mono text-xs">
                              <span className="flex items-center gap-1.5">
                                {p.name}
                                {p.primaryKey ? <Key className="size-3 text-muted-foreground" aria-label="Primärschlüssel" /> : null}
                              </span>
                            </td>
                            <td className="px-4 py-2">{typeOf(p)}</td>
                            <td className="px-4 py-2 text-muted-foreground">
                              {p.enum ? p.enum.join(", ") : p.minimum !== undefined || p.maximum !== undefined ? `${p.minimum ?? "…"} – ${p.maximum ?? "…"}` : "–"}
                            </td>
                            <td className="px-4 py-2 text-muted-foreground">{p.description}</td>
                            <td className="px-4 py-2 text-muted-foreground">{p.required ? "ja" : "nein"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
    </PageBody>
  );
}
