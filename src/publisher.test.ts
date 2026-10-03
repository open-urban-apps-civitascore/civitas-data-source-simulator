import net from "node:net";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createPublisher } from "./publisher.js";

// Port 1 (tcpmux) is closed everywhere these tests run.
const CLOSED_PORT = 1;
const CONNACK = Buffer.from([0x20, 0x02, 0x00, 0x00]);

describe("createPublisher", () => {
  const servers: net.Server[] = [];

  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
  });

  async function listen(onConnection: (socket: net.Socket) => void): Promise<number> {
    const server = net.createServer(onConnection);
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    return (server.address() as net.AddressInfo).port;
  }

  const connect = (port: number) => createPublisher({ url: `mqtt://127.0.0.1:${port}`, topic: "t", clientId: "c" });

  it("reports a closed port as such", async () => {
    await expect(connect(CLOSED_PORT)).rejects.toThrow(`Unter 127.0.0.1:${CLOSED_PORT} nimmt niemand Verbindungen an`);
  });

  it("fails fast when something listens on the port but is not a broker", async () => {
    const hangsUp = await listen((socket) => socket.once("data", () => socket.end()));
    const speaksHttp = await listen((socket) => socket.once("data", () => socket.end("HTTP/1.1 400 Bad Request\r\n\r\n")));
    for (const port of [hangsUp, speaksHttp]) {
      await expect(connect(port)).rejects.toThrow(`Unter 127.0.0.1:${port} antwortet kein MQTT-Broker`);
    }
  });

  it("closes at once while the broker is gone", async () => {
    const sockets: net.Socket[] = [];
    const port = await listen((socket) => {
      sockets.push(socket);
      // Accepts the connection, then acknowledges nothing.
      socket.on("data", (data) => {
        if (data[0] === 0x10) socket.write(CONNACK);
      });
    });
    const publisher = await connect(port);
    void publisher.publish({}).catch(() => undefined);
    for (const socket of sockets) socket.destroy();

    await publisher.close();
  });
});
