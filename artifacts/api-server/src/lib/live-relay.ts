import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { request as httpRequest, type ClientRequest } from "node:http";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import { liquidsoapListenerCount, liquidsoapPassword, liquidsoapRunning } from "./liquidsoap";

const LIVE_SOCKET_PATH = "/api/live/ws";
const PCM_MAGIC = Buffer.from([0x50, 0x43, 0x4d, 0x31]);

let broadcaster: WebSocket | null = null;
let liquidsoapFeed: ClientRequest | null = null;
let live = false;
let broadcastMode: "pcm" | "mp3" | null = null;
let pcmSampleRate = 44100;
let pcmChannels = 2;
let startedAt: Date | null = null;
let lastAudioAt: Date | null = null;
let totalBytes = 0;
const wsListeners = new Set<WebSocket>();

function sendJson(socket: WebSocket, payload: Record<string, unknown>): void {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload));
}

function rawBuffer(data: RawData): Buffer {
  if (Buffer.isBuffer(data)) return data;
  if (Array.isArray(data)) return Buffer.concat(data);
  if (data instanceof ArrayBuffer) return Buffer.from(data);
  return Buffer.from(data);
}

function wavHeader(sampleRate: number, channels: number): Buffer {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(0xffffffff, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  const byteRate = sampleRate * channels * 2;
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(channels * 2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(0xffffffff, 40);
  return header;
}

function closeLiquidsoapFeed(): void {
  if (!liquidsoapFeed) return;
  try { liquidsoapFeed.end(); } catch {}
  liquidsoapFeed = null;
}

function connectLiquidsoapFeed(): void {
  if (liquidsoapFeed || !liquidsoapRunning() || !broadcastMode) return;

  const auth = Buffer.from(`source:${liquidsoapPassword()}`).toString("base64");
  const contentType = broadcastMode === "pcm" ? "audio/wav" : "audio/mpeg";
  const request = httpRequest({
    host: "127.0.0.1",
    port: 8005,
    path: "/live",
    method: "PUT",
    headers: {
      "Content-Type": contentType,
      "Authorization": `Basic ${auth}`,
      "Connection": "keep-alive",
    },
  });

  liquidsoapFeed = request;

  request.on("response", (response) => {
    if ((response.statusCode ?? 500) >= 400) {
      console.error(`[USALB Liquidsoap source] HTTP ${response.statusCode}`);
      request.destroy();
    }
  });
  request.on("error", (error) => {
    console.error("[USALB Liquidsoap source]", error.message);
    if (liquidsoapFeed === request) liquidsoapFeed = null;
  });
  request.on("close", () => {
    if (liquidsoapFeed === request) liquidsoapFeed = null;
  });

  if (broadcastMode === "pcm") {
    request.write(wavHeader(pcmSampleRate, pcmChannels));
  }
}

function feedLiquidsoap(payload: Buffer): void {
  if (!liquidsoapRunning() || !broadcastMode) return;
  if (!liquidsoapFeed) connectLiquidsoapFeed();
  if (!liquidsoapFeed) return;

  try {
    liquidsoapFeed.write(payload);
    lastAudioAt = new Date();
    totalBytes += payload.length;
  } catch {
    closeLiquidsoapFeed();
  }
}

function relay(chunk: Buffer): void {
  if (!broadcastMode) return;

  if (broadcastMode === "pcm") {
    if (!chunk.subarray(0, PCM_MAGIC.length).equals(PCM_MAGIC)) return;
    feedLiquidsoap(chunk.subarray(PCM_MAGIC.length));
    return;
  }

  feedLiquidsoap(chunk);
}

function announceWsStatus(): void {
  for (const socket of wsListeners) {
    sendJson(socket, {
      type: "status",
      live,
      audioMode: broadcastMode,
      sampleRate: pcmSampleRate,
      channels: pcmChannels,
      qualities: live ? [320] : [],
    });
  }
}

function reset(): void {
  closeLiquidsoapFeed();
  broadcaster = null;
  live = false;
  broadcastMode = null;
  startedAt = null;
  lastAudioAt = null;
  totalBytes = 0;

  for (const socket of wsListeners) {
    try { socket.close(1000, "Broadcast ended"); } catch {}
  }
  wsListeners.clear();
}

function sameOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!origin) return false;
  try {
    return new URL(origin).host === (req.headers.host ?? "");
  } catch {
    return false;
  }
}

async function attachBroadcaster(socket: WebSocket, token: string | null, request: IncomingMessage): Promise<void> {
  if (token !== null && token.trim() === "") {
    socket.close(1008, "Invalid broadcaster token");
    return;
  }

  if (!token && request.headers.origin && !sameOrigin(request)) {
    sendJson(socket, { type: "error", message: "Broadcaster must connect from the USALB control room." });
    socket.close(1008, "Broadcaster origin rejected");
    return;
  }

  if (broadcaster && broadcaster !== socket) {
    try { broadcaster.close(1012, "Replaced by a new broadcaster"); } catch {}
  }

  broadcaster = socket;
  live = false;
  broadcastMode = null;
  closeLiquidsoapFeed();

  socket.on("message", (data, isBinary) => {
    if (isBinary) {
      if (live) relay(rawBuffer(data));
      return;
    }

    try {
      const message = JSON.parse(data.toString()) as {
        type?: string;
        codec?: string;
        mimeType?: string;
        pcmSampleRate?: number;
        pcmChannels?: number;
      };

      if (message.type === "start") {
        broadcastMode =
          message.mimeType === "audio/mpeg" || message.codec === "mp3"
            ? "mp3"
            : message.mimeType?.includes("pcm")
              ? "pcm"
              : null;

        if (!broadcastMode) {
          sendJson(socket, { type: "error", message: "Unsupported broadcast format." });
          return;
        }

        if (broadcastMode === "pcm") {
          pcmSampleRate = Number.isFinite(message.pcmSampleRate) && (message.pcmSampleRate ?? 0) > 0
            ? Math.round(message.pcmSampleRate ?? 44100)
            : 44100;
          pcmChannels = Number.isFinite(message.pcmChannels) && (message.pcmChannels ?? 0) > 0
            ? Math.min(2, Math.max(1, Math.round(message.pcmChannels ?? 2)))
            : 2;
        }

        if (!liquidsoapRunning()) {
          sendJson(socket, { type: "error", message: "Liquidsoap stream engine is unavailable." });
          reset();
          return;
        }

        live = true;
        startedAt = new Date();
        lastAudioAt = null;
        totalBytes = 0;
        announceWsStatus();

        sendJson(socket, {
          type: "ready",
          live: true,
          codec: broadcastMode,
          contentType: "audio/mpeg",
          qualities: [320],
        });
      } else if (message.type === "stop") {
        if (broadcaster === socket) reset();
      }
    } catch {
      sendJson(socket, { type: "error", message: "Invalid broadcast message." });
    }
  });

  socket.once("close", () => {
    if (broadcaster === socket) reset();
  });
  socket.once("error", () => {
    if (broadcaster === socket) reset();
  });
}

export function getLiveSnapshot() {
  return {
    streaming: live && lastAudioAt !== null,
    connected: broadcaster !== null,
    listenerCount: liquidsoapListenerCount(),
    contentType: live ? "audio/mpeg" : null,
    bitrateKbps: live ? 320 : null,
    qualities: live ? [320] : [],
    startedAt,
    lastAudioAt,
    totalBytes,
  };
}

export function attachLiveRelay(server: Server): void {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
    if (url.pathname !== LIVE_SOCKET_PATH) {
      socket.destroy();
      return;
    }

    wss.handleUpgrade(request, socket, head, (client) => {
      const role = url.searchParams.get("role");
      const token = url.searchParams.get("key") || request.headers["x-broadcaster-token"]?.toString() || null;

      if (role === "broadcaster") {
        void attachBroadcaster(client, token, request);
        return;
      }

      if (role === "listener") {
        wsListeners.add(client);
        sendJson(client, {
          type: "status",
          live,
          audioMode: broadcastMode,
          sampleRate: pcmSampleRate,
          channels: pcmChannels,
          qualities: live ? [320] : [],
        });
        client.once("close", () => wsListeners.delete(client));
        client.once("error", () => wsListeners.delete(client));
        return;
      }

      sendJson(client, { type: "error", message: "Choose broadcaster or listener mode." });
      client.close(1008, "Invalid live relay role");
    });
  });
}
