import type { IncomingMessage, ServerResponse, Server } from "node:http";
import { WebSocket, WebSocketServer, type RawData } from "ws";

const LIVE_SOCKET_PATH = "/api/live/ws";
const LIVE_STREAM_PATHS = new Set(["/api/live/stream", "/api/radio-stream"]);
const PCM_MAGIC = Buffer.from([0x50, 0x43, 0x4d, 0x31]);
const MAX_RECENT_BYTES = 96 * 1024;

let broadcaster: WebSocket | null = null;
let live = false;
let broadcastMode: "pcm" | "mp3" | null = null;
let pcmSampleRate = 48000;
let pcmChannels = 2;
let startedAt: Date | null = null;
let lastAudioAt: Date | null = null;
let totalBytes = 0;
let recentChunks: Buffer[] = [];
let recentBytes = 0;
const listeners = new Set<ServerResponse>();
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

function remember(chunk: Buffer): void {
  recentChunks.push(Buffer.from(chunk));
  recentBytes += chunk.length;
  while (recentBytes > MAX_RECENT_BYTES && recentChunks.length > 1) {
    const removed = recentChunks.shift();
    if (removed) recentBytes -= removed.length;
  }
}

function pcmPayload(chunk: Buffer): Buffer | null {
  if (!chunk.subarray(0, PCM_MAGIC.length).equals(PCM_MAGIC)) return null;
  return chunk.subarray(PCM_MAGIC.length);
}

function relay(chunk: Buffer): void {
  let payload = chunk;
  if (broadcastMode === "pcm") {
    const pcm = pcmPayload(chunk);
    if (!pcm) return;
    payload = pcm;
  }
  lastAudioAt = new Date();
  totalBytes += payload.length;
  remember(payload);
  for (const socket of wsListeners) { try { socket.close(1000, "Broadcast ended"); } catch {} }
  wsListeners.clear();
  for (const socket of wsListeners) {
    if (socket.readyState === WebSocket.OPEN) {
      try { socket.send(payload); } catch { wsListeners.delete(socket); }
    }
  }
  for (const response of listeners) {
    if (response.writableEnded || response.destroyed) {
      listeners.delete(response);
      continue;
    }
    try {
      response.write(payload);
    } catch {
      listeners.delete(response);
    }
  }
}

function announceWsStatus(): void {
  for (const socket of wsListeners) {
    sendJson(socket, { type: "status", live, audioMode: broadcastMode, sampleRate: pcmSampleRate, channels: pcmChannels });
  }
}

function reset(): void {
  broadcaster = null;
  live = false;
  broadcastMode = null;
  startedAt = null;
  lastAudioAt = null;
  totalBytes = 0;
  recentChunks = [];
  recentBytes = 0;
  for (const response of listeners) {
    try { response.end(); } catch {}
  }
  listeners.clear();
}

function sameOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!origin) return false;
  try {
    const originUrl = new URL(origin);
    return originUrl.host === (req.headers.host ?? "");
  } catch {
    return false;
  }
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

async function attachBroadcaster(socket: WebSocket, token: string | null, request: IncomingMessage): Promise<void> {
  // The browser Live Desk connects from the control room itself. Keep support
  // for the existing paired token, while allowing the same-origin browser
  // console to operate without the retired Windows broadcaster.
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
  recentChunks = [];
  recentBytes = 0;

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
          if (Number.isFinite(message.pcmSampleRate) && (message.pcmSampleRate ?? 0) > 0) {
            pcmSampleRate = Math.round(message.pcmSampleRate ?? 48000);
          }
          if (Number.isFinite(message.pcmChannels) && (message.pcmChannels ?? 0) > 0) {
            pcmChannels = Math.min(2, Math.max(1, Math.round(message.pcmChannels ?? 2)));
          }
        }

        live = true;
        announceWsStatus();
        startedAt = new Date();
        lastAudioAt = null;
        totalBytes = 0;
        recentChunks = [];
        recentBytes = 0;
        sendJson(socket, {
          type: "ready",
          live: true,
          codec: broadcastMode,
          contentType: broadcastMode === "pcm" ? "audio/wav" : "audio/mpeg",
        });
      } else if (message.type === "stop") {
        if (broadcaster === socket) reset();
      }
    } catch {
      sendJson(socket, { type: "error", message: "Invalid broadcast message." });
    }
  });

  socket.once("close", () => { if (broadcaster === socket) reset(); });
  socket.once("error", () => { if (broadcaster === socket) reset(); });
}

export function getLiveSnapshot() {
  return {
    streaming: live && lastAudioAt !== null,
    connected: broadcaster !== null,
    listenerCount: listeners.size,
    contentType: live ? (broadcastMode === "pcm" ? "audio/wav" : "audio/mpeg") : null,
    startedAt,
    lastAudioAt,
    totalBytes,
  };
}

export function handleLiveStreamRequest(req: IncomingMessage, res: ServerResponse): boolean {
  const url = new URL(req.url ?? "", `http://${req.headers.host ?? "localhost"}`);
  if (!LIVE_STREAM_PATHS.has(url.pathname) || req.method !== "GET") return false;

  if (!live || !broadcastMode) {
    res.statusCode = 503;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.end("USALB live stream is offline.");
    return true;
  }

  const isPcm = broadcastMode === "pcm";
  res.writeHead(200, {
    "Content-Type": isPcm ? "audio/wav" : "audio/mpeg",
    "Cache-Control": "no-cache, no-store, must-revalidate, proxy-revalidate",
    Pragma: "no-cache",
    Expires: "0",
    Connection: "keep-alive",
    "Access-Control-Allow-Origin": "*",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders?.();

  listeners.add(res);

  if (isPcm) {
    res.write(wavHeader(pcmSampleRate, pcmChannels));
  }
  for (const chunk of recentChunks) {
    if (!res.writableEnded) res.write(chunk);
  }

  const cleanup = () => listeners.delete(res);
  req.once("close", cleanup);
  res.once("close", cleanup);
  res.once("error", cleanup);
  return true;
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
      } else if (role === "listener") {
        wsListeners.add(client);
        sendJson(client, { type: "status", live, audioMode: broadcastMode, sampleRate: pcmSampleRate, channels: pcmChannels });
        client.once("close", () => wsListeners.delete(client));
        client.once("error", () => wsListeners.delete(client));
        if (!live) return;
        if (broadcastMode !== "pcm") return;
      } else {
        sendJson(client, { type: "error", message: "Choose broadcaster or listener mode." });
        client.close(1008, "Invalid live relay role");
      }
    });
  });
}
