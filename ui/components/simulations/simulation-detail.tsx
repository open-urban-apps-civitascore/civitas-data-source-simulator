"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AlertTriangle, ArrowLeft, Braces, Pencil, Table2, Trash2 } from "lucide-react";

import { PageBody } from "@/components/layout/page-body";
import { FieldTable } from "@/components/simulations/field-table";
import { JsonView } from "@/components/simulations/json-view";
import { LiveStream } from "@/components/simulations/live-stream";
import { StatusBadge, TransportBadge } from "@/components/simulations/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { toDraft, toJson } from "@/lib/api-json";
import { removeSimulation, switchSimulation } from "@/lib/client";
import { formatCadence, formatDateTime, formatNumber, formatRelative } from "@/lib/format";
import type { SimulationDetail as Detail } from "@/lib/types";
import { useSimulationStream } from "@/lib/use-poll";

const POLL_MS = 2000;

export function SimulationDetail({ initial, initialView = "fields" }: { initial: Detail; initialView?: "fields" | "json" }) {
  const router = useRouter();
  const { sim, setSim, events, clearEvents, error } = useSimulationStream(initial.id, initial, POLL_MS);
  const [view, setView] = useState<"fields" | "json">(initialView);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const draft = sim.input ? toDraft(sim.input) : null;

  const toggle = async (enabled: boolean) => {
    setBusy(true);
    setActionError(null);
    setSim({ ...sim, enabled });
    try {
      const updated = await switchSimulation(sim.id, enabled);
      setSim((current) => ({ ...current, ...updated }));
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  };

  const destroy = async () => {
    if (!confirm(`„${sim.name ?? sim.id}“ löschen? Die Simulation stoppt und wird vergessen.`)) return;
    setBusy(true);
    try {
      await removeSimulation(sim.id);
      router.push("/simulations");
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : String(caught));
      setBusy(false);
    }
  };

  // The portal's own names, so this simulation can be found next to what it feeds.
  const origin = sim.origin;
  const belongsTo: { label: string; value: React.ReactNode }[] = [
    ...(origin?.useCase
      ? [{ label: "Use Case", value: [origin.useCase.name, origin.useCase.version].filter(Boolean).join(" ") }]
      : []),
    ...(origin?.dataSet ? [{ label: "Datensatz", value: origin.dataSet.name }] : []),
    ...(origin?.dataSource ? [{ label: "Datenquelle", value: origin.dataSource.name }] : []),
    ...(origin?.dataStructure ? [{ label: "Datenstruktur", value: origin.dataStructure.name }] : []),
    ...(origin?.stream ? [{ label: "Stream", value: <span className="font-mono text-xs">{origin.stream}</span> }] : []),
  ];

  const facts: { label: string; value: React.ReactNode }[] = [
    ...belongsTo,
    { label: "Typ", value: <TransportBadge sim={sim} /> },
    {
      label: sim.transport === "mqtt" ? "Broker" : "Datenbank",
      value: (
        <span className="font-mono text-xs">
          {sim.transport === "mqtt" ? sim.target : "DEMO_DB_DSN (Generator-Konfiguration)"}
        </span>
      ),
    },
    {
      label: sim.transport === "mqtt" ? "Topic" : "Tabelle",
      value: <span className="font-mono text-xs">{sim.topic ?? sim.target}</span>,
    },
    { label: "Takt", value: formatCadence(sim) },
    { label: "Erzeugt", value: formatDateTime(sim.createdAt) },
    {
      label: sim.transport === "mqtt" ? "Nachrichten gesendet" : "Zeilen geschrieben",
      value: formatNumber(sim.publishedCount),
    },
    {
      label: "Letztes Event",
      value: `${formatRelative(sim.lastPublishedAt)}${sim.lastPublishedAt ? ` · ${formatDateTime(sim.lastPublishedAt)}` : ""}`,
    },
  ];
  if (sim.transport === "sql") {
    facts.push({
      label: "Tabellenfüllung",
      value: `${formatNumber(sim.rowCount ?? 0)} / ${formatNumber(sim.maxRows ?? 0)} Zeilen`,
    });
  }
  facts.push({ label: "ID", value: <span className="font-mono text-xs text-muted-foreground">{sim.id}</span> });

  return (
    <PageBody>
      <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <Link
            href="/simulations"
            className="mb-2 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" /> Alle Simulationen
          </Link>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl">{sim.name ?? sim.id}</h1>
            <StatusBadge sim={sim} />
          </div>
          {sim.description ? (
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{sim.description}</p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <label className="flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm">
            <Switch checked={sim.enabled} disabled={busy} onCheckedChange={(v) => void toggle(v)} label="Simulation aktiv" />
            {sim.enabled ? "Aktiv" : "Pausiert"}
          </label>
          <Button variant="outline" size="sm" asChild disabled={!draft}>
            <Link href={`/simulations/${sim.id}/edit`}>
              <Pencil /> Bearbeiten
            </Link>
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            className="text-destructive hover:text-destructive"
            onClick={() => void destroy()}
          >
            <Trash2 /> Löschen
          </Button>
        </div>
      </div>

      {sim.lastError || actionError || error ? (
        <div className="mb-5 flex items-start gap-2 rounded-md border border-error/40 bg-error/10 px-3 py-2 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <div>
            <span className="font-medium">{actionError ?? error ? "Fehler." : "Senden fehlgeschlagen."}</span>{" "}
            <span className="font-mono text-xs">{actionError ?? error ?? sim.lastError}</span>
          </div>
        </div>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-5">
          <Card>
            <CardHeader title="Übersicht" />
            <dl className="grid gap-x-6 gap-y-3 px-5 py-4 sm:grid-cols-2">
              {facts.map((fact) => (
                <div key={fact.label} className="grid gap-0.5">
                  <dt className="text-xs uppercase tracking-wide text-muted-foreground">{fact.label}</dt>
                  <dd className="text-sm">{fact.value}</dd>
                </div>
              ))}
            </dl>
          </Card>

          <Card className="overflow-hidden">
            <CardHeader
              title={view === "fields" ? "Datenstruktur" : "Konfiguration (JSON)"}
              description={
                view === "json"
                  ? "Expertenansicht: genau das, was die Control-API des Generators entgegennimmt."
                  : sim.transport === "mqtt"
                    ? "So sieht jede gesendete Nachricht aus – im eigenen Format des Use Case, nicht in SensorThings."
                    : "So sieht jede geschriebene Zeile aus. Die Spalte „simuliert“ setzt der Generator immer."
              }
              action={<ViewToggle value={view} onChange={setView} />}
            />
            {!draft ? (
              <p className="px-5 py-4 text-sm text-muted-foreground">
                Der Generator hat zu dieser Simulation keine Konfiguration zurückgegeben.
              </p>
            ) : view === "fields" ? (
              <FieldTable scenario={draft.scenario} />
            ) : (
              <JsonView id={sim.id} json={toJson(draft)} />
            )}
          </Card>
        </div>

        <Card className="flex h-[36rem] flex-col overflow-hidden xl:sticky xl:top-0 xl:h-[calc(100svh-7rem)]">
          <CardHeader title="Live-Stream" description="Die zuletzt erzeugten Datensätze." />
          <LiveStream sim={sim} events={events} onClear={clearEvents} pollMs={POLL_MS} />
        </Card>
      </div>
    </PageBody>
  );
}

export function ViewToggle({
  value,
  onChange,
  labels = { fields: "Felder", json: "JSON" },
}: {
  value: "fields" | "json";
  onChange: (v: "fields" | "json") => void;
  labels?: { fields: string; json: string };
}) {
  return (
    <div className="flex shrink-0 gap-0.5 rounded-md bg-muted p-0.5 text-xs">
      {(["fields", "json"] as const).map((v) => (
        <button
          key={v}
          type="button"
          onClick={() => onChange(v)}
          aria-pressed={value === v}
          className={`flex items-center gap-1 rounded px-2.5 py-1 font-medium transition-colors ${
            value === v ? "bg-background shadow-xs" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {v === "fields" ? <Table2 className="size-3.5" /> : <Braces className="size-3.5" />}
          {labels[v]}
        </button>
      ))}
    </div>
  );
}
