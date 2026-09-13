import mqtt, { type MqttClient } from "mqtt";

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
  const client: MqttClient = await mqtt.connectAsync(url, {
    clientId,
    // Clean session: nothing here is worth resuming.
    clean: true,
    connectTimeout: 10_000,
    reconnectPeriod: 5_000,
  });

  return {
    async publish(payload) {
      // QoS 1: at least once. Anything published with no subscriber is still lost.
      const publishResult = await client.publishAsync(topic, JSON.stringify(payload), { qos: 1 });
    },
    async close() {
      await client.endAsync();
    },
  };
}
