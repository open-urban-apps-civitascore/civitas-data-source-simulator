import { describe, expect, it } from "vitest";

import { INVALID_BROKER_URL, mqttTransportSchema, simulationInputSchema } from "./types.js";

describe("scenario cadence", () => {
  const fields = { id: { kind: "sequence" }, wert: { kind: "constant", value: 1 } };
  const sql = (scenario: Record<string, unknown>) =>
    simulationInputSchema.safeParse({
      transport: { kind: "sql", table: "demo.werte" },
      scenario: { fields, table: { columns: { id: "text", wert: "integer" }, primaryKey: "id" }, maxRows: 10, ...scenario },
    });
  const mqtt = (scenario: Record<string, unknown>) =>
    simulationInputSchema.safeParse({
      transport: { kind: "mqtt", url: "mqtt://broker:1883", topic: "t" },
      scenario: { fields, ...scenario },
    });

  it("defaults to the interval, so existing scenarios keep their behaviour", () => {
    expect(sql({}).data?.scenario.cadence).toBe("interval");
    expect(mqtt({}).data?.scenario.cadence).toBe("interval");
  });

  it("accepts a fill for a table", () => {
    expect(sql({ cadence: "fillToLimit" }).success).toBe(true);
  });

  it("refuses a fill on a broker, which keeps no rows", () => {
    const result = mqtt({ cadence: "fillToLimit" });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["scenario", "cadence"]);
  });
});

describe("origin", () => {
  const withOrigin = (origin: unknown) =>
    simulationInputSchema.safeParse({
      transport: { kind: "mqtt", url: "mqtt://broker:1883", topic: "t" },
      scenario: { fields: { v: { kind: "constant", value: 1 } } },
      origin,
    });

  it("is optional, so a simulation made by hand needs none", () => {
    expect(withOrigin(undefined).success).toBe(true);
  });

  it("carries the portal's names and ids", () => {
    const origin = {
      installationId: "inst-42",
      useCase: { id: "urn:openurbanapps:usecase:verkehrszaehlung", name: "Verkehrszählung", version: "1.5.1" },
      dataSet: { name: "Verkehrszählung Musterhausen", id: "c46fa1f9" },
      dataSource: { name: "Zählstellen-Feed", urn: "urn:core:standard:x:datasource:mobility:feed:abc", id: "9f1" },
      dataStructure: { name: "Zählung", urn: "urn:core:standard:x:datastructure:mobility:zaehlung:def" },
      stream: "zaehlstelle-promenade",
    };
    expect(withOrigin(origin).data?.origin).toEqual(origin);
  });

  it("refuses an artifact without the name a person would see", () => {
    expect(withOrigin({ dataSource: { urn: "urn:core:standard:x:datasource:mobility:feed:abc" } }).success).toBe(false);
  });

  it("bounds every string, so a registration cannot carry a novel", () => {
    expect(withOrigin({ dataSet: { name: "x".repeat(201) } }).success).toBe(false);
  });
});

describe("mqttTransportSchema", () => {
  const parse = (url: string) => mqttTransportSchema.safeParse({ kind: "mqtt", url, topic: "t" });

  it("accepts the schemes mqtt.js speaks, trimmed", () => {
    for (const url of ["mqtt://broker:1883", "tcp://broker", "mqtts://user:pw@broker:8883", "wss://broker/mqtt", "mqtt://[::1]:1883"]) {
      expect(parse(url).success, url).toBe(true);
    }
    expect(parse(" mqtt://broker:1883 ").data?.url).toBe("mqtt://broker:1883");
  });

  it("rejects what mqtt.js would misread, with a message for people", () => {
    for (const url of ["localhost:1884", "mqtt://broker:99999", "mqtt://bro ker:1883", "http://broker:1883", "constructor://broker"]) {
      const result = parse(url);
      expect(result.success, url).toBe(false);
      expect(result.error?.issues[0]?.message).toBe(INVALID_BROKER_URL);
    }
  });
});
