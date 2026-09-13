"use client";

import { useEffect, useState } from "react";

import { fetchSimulation } from "./client";
import type { SimulationDetail, StreamEvent } from "./types";

/** `load` must be stable: it is the effect's dependency. */
export function usePoll<T>(load: () => Promise<T>, intervalMs: number, initial: T) {
  const [value, setValue] = useState<T>(initial);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        const next = await load();
        if (cancelled) return;
        setValue(next);
        setError(null);
      } catch (caught) {
        if (!cancelled) setError(caught instanceof Error ? caught.message : String(caught));
      }
    };
    const timer = setInterval(run, intervalMs);
    void run();
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [load, intervalMs]);

  return { value, error, setValue };
}

const MAX_EVENTS = 60;

/**
 * The control API has no event channel, so a new event is a `lastPayload` whose
 * timestamp moved since the last poll. Anything published in between is missed.
 */
export function useSimulationStream(id: string, initial: SimulationDetail, intervalMs: number) {
  const [sim, setSim] = useState<SimulationDetail>(initial);
  const [events, setEvents] = useState<StreamEvent[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let lastSeen: string | null = null;
    let seq = 0;

    const run = async () => {
      try {
        const next = await fetchSimulation(id);
        if (cancelled) return;
        setSim(next);
        setError(null);
        if (next.lastPublishedAt && next.lastPayload && next.lastPublishedAt !== lastSeen) {
          lastSeen = next.lastPublishedAt;
          seq += 1;
          const event: StreamEvent = { seq, at: next.lastPublishedAt, payload: next.lastPayload };
          setEvents((current) => [event, ...current].slice(0, MAX_EVENTS));
        }
      } catch (caught) {
        if (!cancelled) setError(caught instanceof Error ? caught.message : String(caught));
      }
    };

    const timer = setInterval(run, intervalMs);
    void run();
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [id, intervalMs]);

  return { sim, setSim, events, clearEvents: () => setEvents([]), error };
}
