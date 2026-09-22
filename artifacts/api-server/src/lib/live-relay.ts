import type { IncomingMessage, ServerResponse, Server } from "node:http";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import { eq } from "drizzle-orm";
import { db, broadcasterDevicesTable } from "@workspace/db";

const LIVE_SOCKET_PATH = "/api/live/ws";
const MP3_STREAM_PATH = "/api/radio-stream";
const listeners = new Set<ServerResponse>();
let broadcaster: WebSocket | null = null;
let live = false;
let recentMp3Chunks: Buffer[] = [];
let recentMp3Bytes = 0;
let startedAt: Date | null = null;
let lastAudioAt: Date | null = null;
let totalBytes = 0;
const MAX_RECENT_MP3_BYTES = 96 * 1024;

function sendJson(socket: WebSocket, payload: Record<string, unknown>) {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload));
}
function rawBuffer(data: RawData): Buffer {
  if (Buffer.isBuffer(data)) return data;
  if (Array.isArray(data)) return Buffer.concat(data);
  if (data instanceof ArrayBuffer) return Buffer.from(data);
  return Buffer.from(data);
}
async function validToken(token: string | null): Promise<boolean> {
  if (!token) return false;
  const rows = await db.select({ id: broadcasterDevicesTable.id })
    .from(broadcasterDevicesTable)
    .where(eq(broadcasterDevicesTable.publishToken, token))
    .limit(1);
  return rows.length > 0;
}
function reset() {
  broadcaster = null;
  live = false;
  startedAt = null;
  lastAudioAt = null;
  totalBytes = 0;
  recentMp3Chunks = [];
  recentMp3Bytes = 0;
  for (const response of listeners) {
    try { if (!response.writableEnded) response.end(); } catch {}
  }
  listeners.clear();
}
function remember(chunk: Buffer) {
  recentMp3Chunks.push(Buffer.from(chunk));
  recentMp3Bytes += chunk.length;
  while (recentMp3Bytes > MAX_RECENT_MP3_BYTES && recentMp3Chunks.length > 1) {
    const removed = recentMp3Chunks.shift();
    if (removed) recentMp3Bytes -= removed.length;
  }
}
function relay(chunk: Buffer) {
  lastAudioAt = new Date();
  totalBytes += chunk.length;
  remember(chunk);
  for (const response of listeners) {
    if (response.writableEnded || response.destroyed) { listeners.delete(response); continue; }
    try { response.write(chunk); } catch { listeners.delete(response); }
  }
}
async function attachBroadcaster(socket: WebSocket, token: string | null) {
  if (!(await validToken(token))) {
    sendJson(socket, { type: "error", message: "Broadcaster authentication failed." });
    socket.close(1008, "Broadcaster authentication failed");
    return;
  }
  if (broadcaster && broadcaster !== socket) {
    try { broadcaster.close(1012, "Replaced by a new broadcaster"); } catch {}
  }
  broadcaster = socket;
  live = false;
  recentMp3Chunks = [];
  recentMp3Bytes = 0;
  socket.on("message", (data, isBinary) => {
    if (isBinary) { if (live) relay(rawBuffer(data)); return; }
    try {
      const message = JSON.parse(data.toString()) as { type?: string; codec?: string; mimeType?: string };
      if (message.type === "start") {
        live = message.codec === "mp3" || message.mimeType === "audio/mpeg";
        if (live) { startedAt = new Date(); lastAudioAt = null; totalBytes = 0; }
        sendJson(socket, { type: "ready", live, codec: live ? "mp3" : null });
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
  return { streaming: live && lastAudioAt !== null, connected: broadcaster !== null, listenerCount: listeners.size, contentType: live ? "audio/mpeg" : null, startedAt, lastAudioAt, totalBytes };
}
export function handleLiveStreamRequest(req: IncomingMessage, res: ServerResponse): boolean {
  const url = new URL(req.url ?? "", `http://${req.headers.host ?? "localhost"}`);
  if (url.pathname !== MP3_STREAM_PATH || req.method !== "GET") return false;
  if (!live) {
    res.statusCode = 503;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.end("USALB live stream is offline.");
    return true;
  }
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
  listeners.add(res);
  for (const chunk of recentMp3Chunks) if (!res.writableEnded) res.write(chunk);
  const cleanup = () => listeners.delete(res);
  req.once("close", cleanup); res.once("close", cleanup); res.once("error", cleanup);
  return true;
}
export function attachLiveRelay(server: Server) {
  const wss = new WebSocketServer({ noServer: true });
  server.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
    if (url.pathname !== LIVE_SOCKET_PATH) { socket.destroy(); return; }
    wss.handleUpgrade(request, socket, head, client => {
      const role = url.searchParams.get("role");
      const token = url.searchParams.get("key") || request.headers["x-broadcaster-token"]?.toString() || null;
      if (role === "broadcaster") void attachBroadcaster(client, token);
      else { sendJson(client, { type: "status", live }); client.close(1000, "Use /api/radio-stream for audio"); }
    });
  });
}
