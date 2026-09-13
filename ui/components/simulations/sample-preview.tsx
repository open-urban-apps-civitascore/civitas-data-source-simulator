"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { sampleScenario } from "@/lib/client";
import type { WireScenario } from "@/lib/types";

/** Rendered by the generator itself, so this is what it would publish. */
export function SamplePreview({ scenario, count = 3 }: { scenario: WireScenario; count?: number }) {
  const [records, setRecords] = useState<Record<string, unknown>[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [nonce, setNonce] = useState(0);
  const key = JSON.stringify(scenario);

  useEffect(() => {
    let cancelled = false;
    // Debounced: the scenario changes on every keystroke.
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const next = await sampleScenario(JSON.parse(key) as WireScenario, count);
        if (!cancelled) {
          setRecords(next);
          setError(null);
        }
      } catch (caught) {
        if (!cancelled) setError(caught instanceof Error ? caught.message : String(caught));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [key, count, nonce]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b px-4 py-2.5">
        <div className="grid">
          <span className="text-sm font-medium">Vorschau</span>
          <span className="text-xs text-muted-foreground">vom Generator gerendert, nichts gesendet</span>
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={() => setNonce((n) => n + 1)} disabled={loading}>
          <RefreshCw className={loading ? "animate-spin" : ""} /> Neu würfeln
        </Button>
      </div>
      {error ? (
        <div className="flex items-start gap-2 border-b border-error/40 bg-error/10 px-4 py-2 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span>{error}</span>
        </div>
      ) : null}
      <div className="flex-1 overflow-y-auto bg-foreground/95 p-3 font-mono text-xs text-background/90">
        {records.length === 0 && !error ? (
          <p className="p-2 text-background/50">{loading ? "Wird gerendert…" : "Noch keine Vorschau."}</p>
        ) : null}
        {records.map((record, i) => (
          <pre key={i} className="mb-2 whitespace-pre-wrap break-all rounded border border-background/10 bg-background/5 p-2">
            {JSON.stringify(record, null, 2)}
          </pre>
        ))}
      </div>
    </div>
  );
}
