import mqtt, { type MqttClient } from "mqtt";

/**
 * MQTT output. One connection per simulation, each with its OWN client id.
 *
 * The unique id is not cosmetic: NiFi's own ConsumeMQTT uses a fixed client id
 * (`civitas-nifi-consumer`), and the broker log shows flows repeatedly kicking each
 * other off with "session taken over" [live 2026-07-28]. Two publishers sharing an
 * id would do the same to each other, and the symptom (messages silently stopping)
 * is miserable to debug.
 */

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
    // Clean session: a demo publisher has no durable state worth resuming, and a
    // stale session would make the broker hold subscriptions we never use.
    clean: true,
    connectTimeout: 10_000,
    reconnectPeriod: 5_000,
  });

  return {
    async publish(payload) {
      // QoS 1: the pipeline should see every reading at least once. MQTT keeps no
      // history, so anything published while nothing is subscribed is simply lost —
      // that is a property of the transport, not something QoS can fix.
      const publishResult = await client.publishAsync(topic, JSON.stringify(payload), { qos: 1 });
    },
    async close() {
      await client.endAsync();
    },
  };
}
