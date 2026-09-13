"use client";

import { useState } from "react";
import { ChevronDown, Pause, Play, Radio, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { formatTime } from "@/lib/format";
import type { SimulationStatus, StreamEvent } from "@/lib/types";

const PAGE = 5;

export function LiveStream({
  sim,
  events,
  onClear,
  pollMs,
}: {
  sim: SimulationStatus;
  events: StreamEvent[];
  onClear: () => void;
  pollMs: number;
}) {
  const [frozen, setFrozen] = useState<StreamEvent[] | null>(null);
  const [limit, setLimit] = useState(PAGE);
  const paused = frozen !== null;
  const shown = frozen ?? events;
  const visible = shown.slice(0, limit);
  const hidden = shown.length - visible.length;
  const live = sim.enabled && !sim.lastError && !sim.atCap;
  const missing = sim.intervalSeconds * 1000 < pollMs;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-3 border-b px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2 text-sm">
          <span className={`relative flex size-2.5 ${live && !paused ? "" : "opacity-40"}`}>
            {live && !paused ? (
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-success opacity-75" />
            ) : null}
            <span className={`relative inline-flex size-2.5 rounded-full ${live ? "bg-success" : "bg-muted-foreground"}`} />
          </span>
          <Radio className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate font-mono text-xs text-muted-foreground">
            {sim.transport === "mqtt" ? "topic" : "table"} {sim.transport === "mqtt" ? sim.topic : sim.target}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setFrozen(paused ? null : events)}
            title={paused ? "Weiter" : "Anhalten"}
          >
            {paused ? <Play /> : <Pause />}
            {paused ? "Weiter" : "Anhalten"}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => {
              onClear();
              if (paused) setFrozen([]);
              setLimit(PAGE);
            }}
            title="Leeren"
          >
            <Trash2 />
          </Button>
        </div>
      </div>

      {missing ? (
        <p className="border-b bg-warn/20 px-4 py-2 text-xs">
          Der Takt ist kürzer als der Abrufzyklus, deshalb erscheint nicht jedes Event. Der Zähler in der Übersicht
          bleibt vollständig.
        </p>
      ) : null}

      <div className="flex-1 overflow-y-auto bg-foreground/95 p-3 font-mono text-xs text-background/90">
        {shown.length === 0 ? (
          <p className="p-2 text-background/50">
            {live
              ? paused
                ? "Ansicht angehalten."
                : `Warte auf das nächste Event (alle ${sim.intervalSeconds} s)…`
              : sim.lastError
                ? "Keine Events – die Simulation meldet einen Fehler."
                : sim.atCap
                  ? "Keine Events – die Tabelle hat ihre Obergrenze erreicht."
                  : "Keine Events – die Simulation ist pausiert."}
          </p>
        ) : null}
        {visible.map((event) => (
          <div
            key={event.seq}
            className="mb-2 rounded border border-background/10 bg-background/5 p-2 animate-in fade-in slide-in-from-top-1 duration-300"
          >
            <div className="mb-1 flex items-center gap-2 text-[11px] text-background/50">
              <span>#{event.seq}</span>
              <span>{formatTime(event.at)}</span>
              <span className="ml-auto">{sim.transport === "mqtt" ? "publish" : "INSERT"}</span>
            </div>
            <pre className="whitespace-pre-wrap break-all">{JSON.stringify(event.payload, null, 2)}</pre>
          </div>
        ))}
        {hidden > 0 ? (
          <button
            type="button"
            onClick={() => setLimit((l) => l + PAGE)}
            className="mt-1 flex w-full items-center justify-center gap-1.5 rounded border border-dashed border-background/20 py-2 text-background/60 transition-colors hover:bg-background/5 hover:text-background/90"
          >
            <ChevronDown className="size-3.5" /> {Math.min(PAGE, hidden)} ältere laden ({hidden} weitere)
          </button>
        ) : shown.length > 0 ? (
          <p className="py-2 text-center text-[11px] text-background/40">
            {shown.length === 1 ? "Zeigt das letzte Event" : `Zeigt die letzten ${shown.length} Events`}
          </p>
        ) : null}
      </div>
    </div>
  );
}
