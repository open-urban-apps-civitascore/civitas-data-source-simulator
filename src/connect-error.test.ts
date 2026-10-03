import { describe, expect, it } from "vitest";

import { describeBrokerError, describeDatabaseError, errorText } from "./connect-error.js";

const broker = new URL("mqtt://civitas-mosquitto:1883");
const codeError = (code: unknown, message = "") => Object.assign(new Error(message), { code });
const refused = () => Object.assign(new AggregateError([], ""), { code: "ECONNREFUSED" });

describe("describeBrokerError", () => {
  it("points at the configured broker when another one fails", () => {
    const text = describeBrokerError(broker, codeError("ENOTFOUND", "getaddrinfo ENOTFOUND civitas-mosquitto"), "mqtt://localhost:1884");
    expect(text).toContain("„civitas-mosquitto“");
    expect(text).toContain("Der Generator ist für localhost:1884 eingerichtet.");
  });

  it("does not offer the failed broker back under another spelling", () => {
    expect(describeBrokerError(new URL("tcp://mosquitto:1883"), codeError("EAI_AGAIN"), "mqtt://mosquitto")).not.toContain(
      "eingerichtet",
    );
  });

  it("never repeats the configured broker's credentials", () => {
    const text = describeBrokerError(broker, codeError("ENOTFOUND"), "mqtt://user:secret@other:1883");
    expect(text).toContain("other:1883");
    expect(text).not.toContain("secret");
  });

  it("names host and port for a refused connection, even when Node gave no message", () => {
    expect(describeBrokerError(new URL("mqtt://localhost:1884"), refused(), null)).toBe(
      "Unter localhost:1884 nimmt niemand Verbindungen an. Läuft der Broker, und stimmt der Port?",
    );
  });

  it("translates mqtt.js's own failures, which carry no code", () => {
    expect(describeBrokerError(broker, new Error("connack timeout"), null)).toContain("innerhalb von 4 Sekunden");
    expect(describeBrokerError(broker, new Error("Invalid header flag bits, must be 0x0 for puback packet"), null)).toBe(
      "Unter civitas-mosquitto:1883 antwortet kein MQTT-Broker. Stimmt der Port, und läuft der Broker?",
    );
  });

  it("recognises refused credentials", () => {
    expect(describeBrokerError(broker, codeError(5, "Connection refused: Not authorized"), null)).toContain(
      "Anmeldung abgelehnt",
    );
  });

  it("keeps the raw reason for anything it does not know", () => {
    expect(describeBrokerError(broker, codeError("EPROTO", "write EPROTO something"), null)).toContain(
      "write EPROTO something",
    );
  });
});

describe("describeDatabaseError", () => {
  const database = new URL("postgres://demo:pw@localhost:5544/demo_source");

  it("words pg's failures the way the broker's are worded", () => {
    expect(describeDatabaseError(database, refused())).toBe(
      "Unter localhost:5544 nimmt niemand Verbindungen an. Läuft die Datenbank, und stimmt der Port?",
    );
    expect(describeDatabaseError(database, new Error("Connection terminated due to connection timeout"))).toContain(
      "innerhalb von 4 Sekunden",
    );
    expect(describeDatabaseError(database, new Error("Connection terminated unexpectedly"))).toContain(
      "keine Postgres-Datenbank",
    );
    expect(describeDatabaseError(database, codeError("28P01", 'password authentication failed for user "demo"'))).toContain(
      "Anmeldung abgelehnt",
    );
  });
});

describe("errorText", () => {
  it("falls back to the code when the message is empty", () => {
    expect(errorText(refused())).toBe("ECONNREFUSED");
  });
});
