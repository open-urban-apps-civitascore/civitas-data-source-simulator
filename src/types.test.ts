import { describe, expect, it } from "vitest";

import {
  BROKER_URL_WITH_CREDENTIALS,
  INVALID_BROKER_URL,
  mqttTransportSchema,
  simulationInputSchema,
  sqlTransportSchema,
} from "./types.js";

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

describe("write mode and REST", () => {
  const fields = { id: { kind: "sequence" }, wert: { kind: "constant", value: 1 } };
  const sql = (scenario: Record<string, unknown>, sqlFields: Record<string, unknown> = fields) =>
    simulationInputSchema.safeParse({
      transport: { kind: "sql", table: "demo.werte" },
      scenario: {
        fields: sqlFields,
        table: { columns: { id: "text", wert: "integer" }, primaryKey: "id" },
        maxRows: 10,
        ...scenario,
      },
    });
  const rest = (scenario: Record<string, unknown>) =>
    simulationInputSchema.safeParse({ transport: { kind: "rest" }, scenario: { fields, maxRows: 10, ...scenario } });
  const mqtt = (scenario: Record<string, unknown>) =>
    simulationInputSchema.safeParse({
      transport: { kind: "mqtt", url: "mqtt://broker:1883", topic: "t" },
      scenario: { fields, ...scenario },
    });

  it("appends by default, so existing scenarios keep their behaviour", () => {
    expect(sql({}).data?.scenario.writeMode).toBe("append");
  });

  it("replaces a table or a list, but not on a broker", () => {
    expect(sql({ writeMode: "replace" }).success).toBe(true);
    expect(rest({ writeMode: "replace" }).success).toBe(true);
    expect(mqtt({ writeMode: "replace" }).error?.issues[0]?.path).toEqual(["scenario", "writeMode"]);
  });

  it("refuses to replace without a cadence that ticks", () => {
    expect(sql({ writeMode: "replace", cadence: "fillToLimit" }).success).toBe(false);
  });

  it("holds a replace to its own budget, which rewrites every row on every tick", () => {
    expect(rest({ writeMode: "replace", maxRows: 1_000, intervalSeconds: 1 }).success).toBe(true);
    expect(rest({ writeMode: "replace", maxRows: 1_001, intervalSeconds: 1 }).error?.issues[0]?.path).toEqual([
      "scenario",
      "maxRows",
    ]);
    expect(sql({ writeMode: "replace", maxRows: 10_001, intervalSeconds: 60 }).success).toBe(false);
    // Appending keeps the old limit.
    expect(sql({ maxRows: 100_000, intervalSeconds: 1 }).success).toBe(true);
  });

  it("refuses to replace a table whose key is no running number", () => {
    const result = sql({ writeMode: "replace" }, { id: { kind: "enum", values: ["a", "b"] }, wert: fields.wert });
    expect(result.error?.issues[0]?.path).toEqual(["scenario", "fields", "id"]);
  });

  it("takes a REST list without a table, nested fields included", () => {
    const result = simulationInputSchema.safeParse({
      transport: { kind: "rest" },
      scenario: {
        writeMode: "replace",
        fields: { id: { kind: "sequence" }, "ort.lat": { kind: "constant", value: 49.79 } },
        maxRows: 10,
      },
    });
    expect(result.success).toBe(true);
  });

  it("refuses a growing REST list, which would restart its keys after a restart", () => {
    expect(rest({}).error?.issues[0]?.path).toEqual(["scenario", "writeMode"]);
    expect(rest({ cadence: "fillToLimit" }).success).toBe(true);
  });

  it("bounds a REST list, which goes out whole on every fetch", () => {
    expect(rest({ cadence: "fillToLimit", maxRows: undefined }).error?.issues[0]?.path).toEqual(["scenario", "maxRows"]);
    expect(rest({ cadence: "fillToLimit", maxRows: 10_001 }).error?.issues[0]?.path).toEqual(["scenario", "maxRows"]);
    expect(rest({ maxRows: 10_000, cadence: "fillToLimit" }).success).toBe(true);
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
    for (const url of ["mqtt://broker:1883", "tcp://broker", "mqtts://broker:8883", "wss://broker/mqtt", "mqtt://[::1]:1883"]) {
      expect(parse(url).success, url).toBe(true);
    }
    expect(parse(" mqtt://broker:1883 ").data?.url).toBe("mqtt://broker:1883");
  });

  it("refuses a user or password in the address, since settings are stored and shown", () => {
    for (const url of ["mqtts://user:pw@broker:8883", "mqtt://user@broker:1883"]) {
      const result = parse(url);
      expect(result.success, url).toBe(false);
      expect(result.error?.issues[0]?.message).toBe(BROKER_URL_WITH_CREDENTIALS);
    }
  });

  it("rejects what mqtt.js would misread, with a message for people", () => {
    for (const url of ["localhost:1884", "mqtt://broker:99999", "mqtt://bro ker:1883", "http://broker:1883", "constructor://broker"]) {
      const result = parse(url);
      expect(result.success, url).toBe(false);
      expect(result.error?.issues[0]?.message).toBe(INVALID_BROKER_URL);
    }
  });
});

describe("sqlTransportSchema", () => {
  it("keeps the platform's read address without user and password", () => {
    const parsed = sqlTransportSchema.parse({
      kind: "sql",
      table: "kataster.baeume",
      readDsn: "postgres://kataster:geheim@baumkataster-db:5432/fachverfahren",
    });
    expect(parsed.readDsn).toBe("postgres://baumkataster-db:5432/fachverfahren");
  });

  it("drops a read address that is no address, and any write address a caller sends", () => {
    const parsed = sqlTransportSchema.parse({
      kind: "sql",
      table: "kataster.baeume",
      readDsn: "host=db password=geheim",
      dsn: "postgres://demo:geheim@elsewhere:5432/db",
    });
    expect(parsed).toEqual({ kind: "sql", table: "kataster.baeume" });
  });
});
