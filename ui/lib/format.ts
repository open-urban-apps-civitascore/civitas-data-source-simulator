import type { Cadence } from "./types";

const dateTime = new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short" });
const time = new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
const number = new Intl.NumberFormat("de-DE");

export function formatDateTime(iso: string | null): string {
  return iso ? dateTime.format(new Date(iso)) : "–";
}

export function formatTime(iso: string): string {
  return time.format(new Date(iso));
}

export function formatNumber(n: number): string {
  return number.format(n);
}

export function formatRelative(iso: string | null, now = Date.now()): string {
  if (!iso) return "noch nie";
  const seconds = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (seconds < 5) return "gerade eben";
  if (seconds < 60) return `vor ${seconds} s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `vor ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `vor ${hours} h`;
  return `vor ${Math.round(hours / 24)} Tagen`;
}

export function formatInterval(seconds: number): string {
  if (seconds < 60) return `alle ${seconds} s`;
  if (seconds % 60 === 0) return `alle ${seconds / 60} min`;
  return `alle ${Math.floor(seconds / 60)} min ${seconds % 60} s`;
}

/** A filled table has no interval worth showing. */
export function formatCadence(sim: { cadence?: Cadence; intervalSeconds: number }): string {
  return sim.cadence === "fillToLimit" ? "einmalig bis zur Obergrenze" : formatInterval(sim.intervalSeconds);
}
