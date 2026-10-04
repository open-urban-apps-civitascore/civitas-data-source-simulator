"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AlertTriangle, Plus, Search } from "lucide-react";

import { PageBody } from "@/components/layout/page-body";
import { StatusBadge, TransportBadge } from "@/components/simulations/status-badge";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { fetchSimulations, switchSimulation } from "@/lib/client";
import { formatCadence, formatDateTime, formatNumber, formatRelative } from "@/lib/format";
import type { SimulationStatus } from "@/lib/types";
import { usePoll } from "@/lib/use-poll";

const POLL_MS = 2000;
const MAX_SIMULATIONS = 50;

type Filter = "all" | "enabled" | "disabled" | "mqtt" | "sql";

const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "Alle" },
  { value: "enabled", label: "Aktiv" },
  { value: "disabled", label: "Pausiert" },
  { value: "mqtt", label: "MQTT" },
  { value: "sql", label: "SQL" },
];

export function SimulationList({ initial }: { initial: SimulationStatus[] }) {
  const { value: simulations, error, setValue } = usePoll(fetchSimulations, POLL_MS, initial);
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [switching, setSwitching] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const toggle = async (sim: SimulationStatus, enabled: boolean) => {
    setSwitching(sim.id);
    setActionError(null);
    // Optimistic; the next poll corrects it if the service refuses.
    setValue(simulations.map((s) => (s.id === sim.id ? { ...s, enabled } : s)));
    try {
      const updated = await switchSimulation(sim.id, enabled);
      setValue((current) => current.map((s) => (s.id === sim.id ? updated : s)));
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : String(caught));
      setValue(await fetchSimulations().catch(() => simulations));
    } finally {
      setSwitching(null);
    }
  };

  const visible = simulations.filter((s) => {
    if (filter === "enabled" && !s.enabled) return false;
    if (filter === "disabled" && s.enabled) return false;
    if (filter === "mqtt" && s.transport !== "mqtt") return false;
    if (filter === "sql" && s.transport !== "sql") return false;
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return `${s.name ?? ""} ${s.description ?? ""} ${s.topic ?? ""} ${s.target} ${s.id}`
      .toLowerCase()
      .includes(q);
  });

  return (
    <PageBody>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1>Simulationen</h1>
          <p className="text-sm text-muted-foreground">
            {simulations.length} von {MAX_SIMULATIONS} möglichen · {simulations.filter((s) => s.enabled).length} senden
            gerade
          </p>
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Suchen…" className="w-56 pl-8" />
        </div>
      </div>

      {error || actionError ? (
        <div className="mb-3 flex items-start gap-2 rounded-md border border-error/40 bg-error/10 px-3 py-2 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span>{actionError ?? error}</span>
        </div>
      ) : null}

      <div className="mb-3 flex flex-wrap gap-1">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            onClick={() => setFilter(f.value)}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
              filter === f.value ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="overflow-x-auto rounded-lg border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-2.5 font-medium">Aktiv</th>
              <th className="px-4 py-2.5 font-medium">Name</th>
              <th className="px-4 py-2.5 font-medium">Typ</th>
              <th className="px-4 py-2.5 font-medium">Ziel</th>
              <th className="px-4 py-2.5 font-medium">Takt</th>
              <th className="px-4 py-2.5 font-medium">Status</th>
              <th className="px-4 py-2.5 text-right font-medium">Gesendet</th>
              <th className="px-4 py-2.5 font-medium">Letztes Event</th>
              <th className="px-4 py-2.5 font-medium">Erzeugt</th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-4 py-10 text-center text-muted-foreground">
                  {simulations.length === 0 ? (
                    <span className="flex flex-col items-center gap-2">
                      Noch keine Simulation registriert.
                      <Link href="/simulations/new" className="inline-flex items-center gap-1 underline">
                        <Plus className="size-3.5" /> Die erste anlegen
                      </Link>
                    </span>
                  ) : (
                    "Keine Simulationen gefunden."
                  )}
                </td>
              </tr>
            ) : null}
            {visible.map((sim) => (
              <tr
                key={sim.id}
                onClick={() => router.push(`/simulations/${sim.id}`)}
                className="cursor-pointer border-t transition-colors hover:bg-muted/40"
              >
                <td className="px-4 py-3">
                  <Switch
                    checked={sim.enabled}
                    disabled={switching === sim.id}
                    onCheckedChange={(v) => void toggle(sim, v)}
                    label={`${sim.name ?? sim.id} aktivieren`}
                  />
                </td>
                <td className="px-4 py-3">
                  <Link
                    href={`/simulations/${sim.id}`}
                    className="font-medium hover:underline"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {sim.name ?? sim.id}
                  </Link>
                  <div className="max-w-xs truncate text-xs text-muted-foreground">
                    {sim.description ?? sim.id}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <TransportBadge sim={sim} />
                </td>
                <td
                  className="max-w-48 truncate px-4 py-3 font-mono text-xs text-muted-foreground"
                  title={sim.topic ?? sim.target}
                >
                  {sim.topic ?? sim.target}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                  {formatCadence(sim)}
                </td>
                <td className="px-4 py-3">
                  <StatusBadge sim={sim} />
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                  {formatNumber(sim.publishedCount)}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                  {formatRelative(sim.lastPublishedAt)}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{formatDateTime(sim.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </PageBody>
  );
}
