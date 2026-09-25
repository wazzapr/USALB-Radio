import type { IncomingMessage, ServerResponse, Server } from "node:http";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

import { WebSocket, WebSocketServer, type RawData } from "ws";

const LIVE_SOCKET_PATH = "/api/live/ws";
const PCM_MAGIC = Buffer.from([0x50, 0x43, 0x4d, 0x31]);
const MAX_RECENT_BYTES = 96 * 1024;
const QUALITY_PATHS = new Map<string, 320>([
  ["/api/live/stream", 320],
  ["/api/live/stream-320", 320],
]);
type Quality = 320;
type Encoder = { bitrate: Quality; process: ChildProcessWithoutNullStreams; recentChunks: Buffer[]; recentBytes: number };
const encoders = new Map<Quality, Encoder>();
let broadcaster: WebSocket | null = null;
let live = false;
let broadcastMode: "pcm" | "mp3" | null = null;
let pcmSampleRate = 48000;
let pcmChannels = 2;
let startedAt: Date | null = null;
let lastAudioAt: Date | null = null;
let totalBytes = 0;
const listeners = new Map<ServerResponse, Quality>();
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

function rememberEncoder(encoder: Encoder, chunk: Buffer): void {
  encoder.recentChunks.push(Buffer.from(chunk));
  encoder.recentBytes += chunk.length;
  while (encoder.recentBytes > MAX_RECENT_BYTES && encoder.recentChunks.length > 1) {
    const removed = encoder.recentChunks.shift();
    if (removed) encoder.recentBytes -= removed.length;
  }
}

function spawnEncoder(bitrate: Quality): Encoder {
  const child = spawn(process.env.FFMPEG_PATH || "ffmpeg", [
    "-hide_banner", "-loglevel", "error",
    "-f", "s16le", "-ar", String(pcmSampleRate), "-ac", String(pcmChannels), "-i", "pipe:0",
    "-vn", "-codec:a", "libmp3lame", "-b:a", `${bitrate}k`, "-ar", "44100", "-ac", "2",
    "-f", "mp3", "-flush_packets", "1", "pipe:1",
  ], { stdio: ["pipe", "pipe", "pipe"] });
  const encoder: Encoder = { bitrate, process: child, recentChunks: [], recentBytes: 0 };
  child.stdout.on("data", (chunk: Buffer) => {
    lastAudioAt = new Date();
    totalBytes += chunk.length;
    rememberEncoder(encoder, chunk);
    for (const [response, quality] of listeners) {
      if (quality !== bitrate) continue;
      if (response.writableEnded || response.destroyed) { listeners.delete(response); continue; }
      try { response.write(chunk); } catch { listeners.delete(response); }
    }
  });
  child.stderr.on("data", (chunk) => { const message = chunk.toString().trim(); if (message) console.error(`[USALB ffmpeg ${bitrate}k] ${message}`); });
  child.once("error", () => { if (broadcaster) sendJson(broadcaster, { type: "error", message: "Server audio encoder is unavailable." }); reset(); });
  child.once("exit", (code) => { if (live && broadcaster && code !== 0) { if (broadcaster) sendJson(broadcaster, { type: "error", message: "Server audio encoder stopped." }); reset(); } });
  return encoder;
}

function startEncoders(): boolean {
  stopEncoders();
  try {
    encoders.set(320, spawnEncoder(320));
    return true;
  } catch { stopEncoders(); return false; }
}

function stopEncoders(): void {
  for (const encoder of encoders.values()) {
    try { encoder.process.stdin.end(); } catch {}
    try { encoder.process.kill("SIGTERM"); } catch {}
  }
  encoders.clear();
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
    for (const encoder of encoders.values()) {
      if (!encoder.process.stdin.destroyed) {
        try { encoder.process.stdin.write(payload); } catch { reset(); return; }
      }
    }
    return;
  }
  const encoder = encoders.get(320);
  if (!encoder) return;
  lastAudioAt = new Date();
  totalBytes += payload.length;
  rememberEncoder(encoder, payload);
  for (const [response, quality] of listeners) {
    if (quality !== 320) continue;
    if (response.writableEnded || response.destroyed) { listeners.delete(response); continue; }
    try { response.write(payload); } catch { listeners.delete(response); }
  }
}

function announceWsStatus(): void {
  for (const socket of wsListeners) {
    sendJson(socket, { type: "status", live, audioMode: broadcastMode, sampleRate: pcmSampleRate, channels: pcmChannels, qualities: live ? [320] : [] });
  }
}

function reset(): void {
  broadcaster = null;
  live = false;
  broadcastMode = null;
  startedAt = null;
  lastAudioAt = null;
  totalBytes = 0;
  for (const socket of wsListeners) { try { socket.close(1000, "Broadcast ended"); } catch {} }
  wsListeners.clear();
  for (const encoder of encoders.values()) { try { encoder.process.stdin.end(); } catch {} try { encoder.process.kill("SIGTERM"); } catch {} }
  encoders.clear();
  for (const response of listeners.keys()) { try { response.end(); } catch {} }
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
          if (!startEncoders()) {
            sendJson(socket, { type: "error", message: "Server audio encoder is unavailable." });
            reset();
            return;
          }
        }

        live = true;
        announceWsStatus();
        startedAt = new Date();
        lastAudioAt = null;
        totalBytes = 0;
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

  socket.once("close", () => { if (broadcaster === socket) reset(); });
  socket.once("error", () => { if (broadcaster === socket) reset(); });
}

export function getLiveSnapshot() {
  return {
    streaming: live && lastAudioAt !== null,
    connected: broadcaster !== null,
    listenerCount: listeners.size,
    contentType: live ? "audio/mpeg" : null,
    bitrateKbps: live ? 320 : null,
    qualities: live ? [320] : [],
    startedAt,
    lastAudioAt,
    totalBytes,
  };
}

export function handleLiveStreamRequest(req: IncomingMessage, res: ServerResponse): boolean {
  const url = new URL(req.url ?? "", `http://${req.headers.host ?? "localhost"}`);
  const quality = QUALITY_PATHS.get(url.pathname) ?? null;
  if (quality === null || req.method !== "GET") return false;

  if (!live || !broadcastMode) {
    res.statusCode = 503;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.end("USALB live stream is offline.");
    return true;
  }

  const selectedQuality: Quality = broadcastMode === "pcm" ? quality : 320;
  const encoder = encoders.get(selectedQuality);
  if (!encoder) { res.statusCode = 503; res.setHeader("Content-Type", "text/plain; charset=utf-8"); res.end("Requested stream quality is unavailable."); return true; }
  res.writeHead(200, {
    "Content-Type": "audio/mpeg",
    "Cache-Control": "no-cache, no-store, must-revalidate, proxy-revalidate",
    Pragma: "no-cache",
    Expires: "0",
    Connection: "keep-alive",
    "Access-Control-Allow-Origin": "*",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders?.();

  listeners.set(res, selectedQuality);

  for (const chunk of encoder.recentChunks) {
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
