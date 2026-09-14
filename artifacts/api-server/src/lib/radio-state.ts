import type { WebSocket } from "ws";
import { logger } from "./logger";

export type BroadcasterStatus = "CONNECTED" | "STREAMING" | "DISCONNECTED" | "RECONNECTING";

type Heartbeat = {
  status: BroadcasterStatus;
  bitrateKbps: number | null;
  sampleRate: number | null;
  contentType: string | null;
  receivedAt: Date;
};

const connectedClients = new Map<string, WebSocket>();
let latestHeartbeat: Heartbeat | null = null;

export function recordBroadcasterHeartbeat(heartbeat: Omit<Heartbeat, "receivedAt">): void {
  latestHeartbeat = { ...heartbeat, receivedAt: new Date() };
  broadcast({ type: "broadcaster", ...getBroadcasterSnapshot() });
}

export function getBroadcasterSnapshot(): Heartbeat & { connected: boolean } {
  const heartbeat = latestHeartbeat ?? {
    status: "DISCONNECTED" as const,
    bitrateKbps: null,
    sampleRate: null,
    contentType: null,
    receivedAt: new Date(0),
  };
  const connected = heartbeat.receivedAt.getTime() > Date.now() - 30_000 && heartbeat.status !== "DISCONNECTED";
  return { ...heartbeat, connected };
}

export function addListener(listenerId: string, socket: WebSocket): void {
  connectedClients.set(listenerId, socket);
  socket.on("close", () => {
    connectedClients.delete(listenerId);
    broadcast({ type: "listeners", count: getListenerCount() });
  });
  socket.on("error", (error) => {
    logger.warn({ error, listenerId }, "Listener WebSocket error");
    connectedClients.delete(listenerId);
  });
  socket.send(JSON.stringify({ type: "listeners", count: getListenerCount() }));
  broadcast({ type: "listeners", count: getListenerCount() });
}

export function getListenerCount(): number {
  return connectedClients.size;
}

export function broadcast(payload: unknown): void {
  const message = JSON.stringify(payload);
  for (const [listenerId, socket] of connectedClients) {
    if (socket.readyState === socket.OPEN) {
      socket.send(message);
    } else if (socket.readyState === socket.CLOSED) {
      connectedClients.delete(listenerId);
    }
  }
}