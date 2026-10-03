import { parseBrokerUrl } from "./types.js";

/** Below the callers' 5 s request timeout, so they hear the reason instead of their own timeout. */
export const CONNECT_TIMEOUT_MS = 4_000;

type Reason = "unresolvable" | "refused" | "unreachable" | "reset" | "timeout" | "not-the-service" | "login";

interface Service {
  name: string;
  none: string;
}

const BROKER: Service = { name: "der Broker", none: "kein MQTT-Broker" };
const DATABASE: Service = { name: "die Datenbank", none: "keine Postgres-Datenbank" };

// Keyed on the code: a refused port can arrive with an empty message.
const NETWORK_REASONS = new Map<unknown, Reason>([
  ["ENOTFOUND", "unresolvable"],
  ["EAI_AGAIN", "unresolvable"],
  ["ECONNREFUSED", "refused"],
  ["EHOSTUNREACH", "unreachable"],
  ["ENETUNREACH", "unreachable"],
  ["ETIMEDOUT", "unreachable"],
  ["ECONNRESET", "reset"],
]);

const codeOf = (error: unknown): unknown => (error as { code?: unknown } | null)?.code;

/** Never empty: an error without a message still has its code. */
export function errorText(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message || String(codeOf(error) ?? "unbekannter Fehler");
}

export function describeBrokerError(target: URL, error: unknown, configuredUrl: string | null): string {
  const configured = configuredUrl ? parseBrokerUrl(configuredUrl) : null;
  const hint =
    configured && configured.hostname !== target.hostname ? ` Der Generator ist für ${configured.host} eingerichtet.` : "";
  return describe(target, BROKER, brokerReason(error), error) + hint;
}

export function describeDatabaseError(target: URL, error: unknown): string {
  return describe(target, DATABASE, databaseReason(error), error);
}

function brokerReason(error: unknown): Reason | undefined {
  const code = codeOf(error);
  if (code === 4 || code === 5) return "login";
  if (errorText(error) === "connack timeout") return "timeout";
  // mqtt.js gives no code when the other side hangs up or answers in something other than MQTT.
  if (code === undefined) return "not-the-service";
  return NETWORK_REASONS.get(code);
}

function databaseReason(error: unknown): Reason | undefined {
  const code = codeOf(error);
  if (code === "28P01" || code === "28000") return "login";
  const message = errorText(error);
  if (message === "Connection terminated due to connection timeout") return "timeout";
  // pg's words for a server that hangs up without speaking Postgres.
  if (message === "Connection terminated unexpectedly") return "not-the-service";
  return NETWORK_REASONS.get(code);
}

function describe(target: URL, service: Service, reason: Reason | undefined, error: unknown): string {
  const where = target.host;
  switch (reason) {
    case "unresolvable":
      return `Den Namen „${target.hostname}“ kann der Generator nicht auflösen: In seinem Netz gibt es ihn nicht.`;
    case "refused":
      return `Unter ${where} nimmt niemand Verbindungen an. Läuft ${service.name}, und stimmt der Port?`;
    case "unreachable":
      return `${where} ist vom Generator aus nicht erreichbar.`;
    case "reset":
      return `Die Verbindung zu ${where} brach ab, bevor ${service.name} geantwortet hat.`;
    case "timeout":
      return `Unter ${where} meldet sich ${service.none}: keine Antwort innerhalb von ${CONNECT_TIMEOUT_MS / 1000} Sekunden.`;
    case "not-the-service":
      return `Unter ${where} antwortet ${service.none}. Stimmt der Port, und läuft ${service.name}?`;
    case "login":
      return `Unter ${where} wurde die Anmeldung abgelehnt. Stimmen Benutzername und Passwort?`;
  }
  return `Die Verbindung zu ${where} ist fehlgeschlagen: ${errorText(error)}.`;
}
