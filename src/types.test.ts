import { describe, expect, it } from "vitest";

import { INVALID_BROKER_URL, mqttTransportSchema } from "./types.js";

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
