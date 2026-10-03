import mqtt, { type MqttClient } from "mqtt";

import { defaultBrokerUrl } from "./config.js";
import { CONNECT_TIMEOUT_MS, describeBrokerError } from "./connect-error.js";
import { INVALID_BROKER_URL, parseBrokerUrl } from "./types.js";

// One connection per simulation, each with its own client id. Sharing an id
// makes brokers kick the connections off with "session taken over", and the
// symptom is messages silently stopping.

export interface Publisher {
  publish(payload: unknown): Promise<void>;
  close(): Promise<void>;
}

export interface PublisherOptions {
  url: string;
  topic: string;
  clientId: string;
}

export async function createPublisher({ url, topic, clientId }: PublisherOptions): Promise<Publisher> {
  const target = parseBrokerUrl(url);
  if (!target) throw new Error(INVALID_BROKER_URL);

  let client: MqttClient;
  try {
    client = await mqtt.connectAsync(
      url,
      {
        clientId,
        // Clean session: nothing here is worth resuming.
        clean: true,
        connectTimeout: CONNECT_TIMEOUT_MS,
        reconnectPeriod: 5_000,
      },
      // No retries on the first attempt: a non-MQTT listener closes without an
      // error, and the promise would never settle. Later reconnects still happen.
      false,
    );
  } catch (error) {
    console.error(`[demo-generator] broker connect to ${target.host} failed:`, error);
    throw new Error(describeBrokerError(target, error, defaultBrokerUrl()), { cause: error });
  }

  return {
    async publish(payload) {
      // Fail the tick rather than queue: the status should show the outage.
      if (!client.connected) {
        throw new Error(`Keine Verbindung zum Broker unter ${target.host}. Der Generator verbindet sich neu.`);
      }
      // QoS 1: at least once. Anything published with no subscriber is still lost.
      await client.publishAsync(topic, JSON.stringify(payload), { qos: 1 });
    },
    async close() {
      // Forced: otherwise it waits for acknowledgements a missing broker never sends.
      await client.endAsync(true);
    },
  };
}
