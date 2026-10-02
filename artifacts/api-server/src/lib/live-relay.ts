import type { IncomingMessage, ServerResponse, Server } from "node:http";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import type { Socket } from "node:net";
import { eq } from "drizzle-orm";
import { broadcasterDevicesTable, db } from "@workspace/db";
import { recordBroadcasterHeartbeat } from "./radio-state";

import { WebSocket, WebSocketServer, type RawData } from "ws";

const LIVE_SOCKET_PATH = "/api/live/ws";
const PCM_MAGIC = Buffer.from([0x50, 0x43, 0x4d, 0x31]);
// Keep roughly 10–13 seconds of 320 kbps MP3 for a new listener. This gives the browser a safety cushion without changing the live relay timeline.
const MAX_RECENT_BYTES = 512 * 1024;
const QUALITY_PATHS = new Map<string, 320>([
  ["/api/live/stream", 320],
  ["/api/radio-stream", 320],
  ["/api/live/stream-320", 320],
]);
type Quality = 320;
type Encoder = { bitrate: Quality; process: ChildProcessWithoutNullStreams; recentChunks: Buffer[]; recentBytes: number };
const encoders = new Map<Quality, Encoder>();
let broadcaster: WebSocket | null = null;
let pendingBroadcaster: WebSocket | null = null;
let httpBroadcaster: IncomingMessage | null = null;
let httpBroadcasterResponse: ServerResponse | null = null;
let live = false;
let broadcastMode: "pcm" | "mp3" | null = null;
let pcmSampleRate = 48000;
let pcmChannels = 2;
let startedAt: Date | null = null;
let lastAudioAt: Date | null = null;
let totalBytes = 0;
let encodedChunks = 0;
let encoderStartedAt: Date | null = null;
let broadcasterConnectedAt: Date | null = null;
let lastBroadcasterCloseAt: Date | null = null;
let lastBroadcasterCloseCode: number | null = null;
let lastBroadcasterCloseReason: string | null = null;
let lastResetReason: string | null = null;
let listenerSequence = 0;
const listeners = new Map<ServerResponse, Quality>();
const listenerIds = new Map<ServerResponse, number>();
const wsListeners = new Set<WebSocket>();
// HTTP chunk boundaries are not guaranteed to match broadcaster audio frames.
// Keep a small framing buffer so a PCM1 header split across TCP chunks is not lost.
let pcmPending = Buffer.alloc(0);
// Last complete PCM frame accepted by the encoder. The replacement socket mirrors
// the same live frame during handoff; identical first frames are ignored to avoid
// a duplicate 20 ms frame in the listener stream.
let lastPcmFrame: Buffer | null = null;
let broadcasterDisconnectTimer: NodeJS.Timeout | null = null;
const BROADCASTER_RECONNECT_GRACE_MS = 30_000;
const BROADCASTER_WS_PING_MS = 20_000;
// Server-side handoff protocol: keep the current broadcaster authoritative until the replacement has sent its first PCM frame.
const SEAMLESS_HANDOFF_PROTOCOL = "first-pcm-v2";

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
    encodedChunks += 1;
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
    encoderStartedAt = new Date();
    console.info("[USALB relay] encoder started: 320k MP3, 44100 Hz stereo");
    return true;
  } catch { stopEncoders(); return false; }
}

function stopPcmContinuity(): void {
  if (pcmContinuityTimer) {
    clearInterval(pcmContinuityTimer);
    pcmContinuityTimer = null;
  }
}

function startPcmContinuity(): void {
  stopPcmContinuity();
  pcmContinuityTimer = setInterval(() => {
    if (!live || broadcastMode !== "pcm" || !lastPcmFrame || !encoders.size) return;
    // Broadcaster PCM is 20 ms/frame. Only bridge a genuine missed frame;
    // normal frames refresh lastPcmFrameAt before this timer can fire.
    if (lastPcmFrameAt <= 0 || Date.now() - lastPcmFrameAt < 28) return;
    for (const encoder of encoders.values()) {
      if (encoder.process.stdin.destroyed || encoder.process.stdin.writableEnded) continue;
      try {
        encoder.process.stdin.write(lastPcmFrame);
        lastPcmFrameAt = Date.now();
      } catch {
        reset("PCM continuity write failed");
        return;
      }
    }
  }, 10);
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
  if (broadcastMode === "pcm") {
    // The broadcaster sends: [PCM1 magic][exact 20 ms PCM frame]. TCP/HTTP
    // may split or coalesce these writes, so never assume one request "data"
    // event contains one complete frame.
    pcmPending = pcmPending.length ? Buffer.concat([pcmPending, chunk]) : Buffer.from(chunk);
    const frameBytes = Math.max(1, Math.round(pcmSampleRate * pcmChannels * 2 * 0.02));
    const packetBytes = PCM_MAGIC.length + frameBytes;

    while (pcmPending.length >= PCM_MAGIC.length) {
      const magicAt = pcmPending.indexOf(PCM_MAGIC);
      if (magicAt < 0) {
        pcmPending = pcmPending.subarray(Math.max(0, pcmPending.length - PCM_MAGIC.length + 1));
        return;
      }
      if (magicAt > 0) pcmPending = pcmPending.subarray(magicAt);
      if (pcmPending.length < packetBytes) return;

      const payload = pcmPending.subarray(PCM_MAGIC.length, packetBytes);
      pcmPending = pcmPending.subarray(packetBytes);
      lastPcmFrame = Buffer.from(payload);
          for (const encoder of encoders.values()) {
        if (!encoder.process.stdin.destroyed) {
          try { encoder.process.stdin.write(payload); } catch { reset(); return; }
        }
      }
    }
    return;
  }
  let payload = chunk;
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

function recordIngestHeartbeat(): void {
  recordBroadcasterHeartbeat({
    status: "STREAMING",
    bitrateKbps: 320,
    sampleRate: pcmSampleRate,
    contentType: "audio/pcm",
  });
}

function announceWsStatus(): void {
  for (const socket of wsListeners) {
    sendJson(socket, { type: "status", live, audioMode: broadcastMode, sampleRate: pcmSampleRate, channels: pcmChannels, qualities: live ? [320] : [] });
  }
}

function cancelBroadcasterDisconnectGrace(): void {
  if (broadcasterDisconnectTimer) {
    clearTimeout(broadcasterDisconnectTimer);
    broadcasterDisconnectTimer = null;
  }
}

function reset(reason = "reset"): void {
  cancelBroadcasterDisconnectGrace();
  lastResetReason = reason;
  console.info(`[USALB relay] reset: ${reason}; listeners=${listeners.size}; encodedChunks=${encodedChunks}; totalBytes=${totalBytes}`);
  broadcaster = null;
  pendingBroadcaster = null;
  if (httpBroadcasterResponse && !httpBroadcasterResponse.writableEnded) {
    try { httpBroadcasterResponse.end(); } catch {}
  }
  httpBroadcaster = null;
  httpBroadcasterResponse = null;
  live = false;
  broadcastMode = null;
  startedAt = null;
  lastAudioAt = null;
  totalBytes = 0;
  encodedChunks = 0;
  encoderStartedAt = null;
  broadcasterConnectedAt = null;
  pcmPending = Buffer.alloc(0);
  lastPcmFrame = null;
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

  const previousBroadcaster = broadcaster;
  if (pendingBroadcaster && pendingBroadcaster !== socket) {
    try { pendingBroadcaster.close(1012, "Replaced by a newer broadcaster"); } catch {}
  }

  cancelBroadcasterDisconnectGrace();
  const resumingExistingBroadcast = live && encoders.has(320);

  // Keep the current source active while a planned replacement completes its
  // handshake. The replacement becomes authoritative only on its first PCM
  // frame, so listeners do not see a deliberate handoff gap.
  if (previousBroadcaster && previousBroadcaster !== socket) {
    pendingBroadcaster = socket;
    console.info(`[USALB relay] broadcaster replacement connected; handoff=${SEAMLESS_HANDOFF_PROTOCOL}; waiting for first PCM frame; resuming=${resumingExistingBroadcast}`);
  } else {
    broadcaster = socket;
    pendingBroadcaster = null;
    broadcasterConnectedAt = new Date();
    console.info(`[USALB relay] broadcaster connected; resuming=${resumingExistingBroadcast}`);
  }

  // Keep the long-lived broadcaster WebSocket active through reverse proxies.
  // This is a WebSocket control-frame ping only: it never terminates a healthy
  // broadcast and does not replace the broadcaster's audio traffic.
  const pingTimer = setInterval(() => {
    if (socket.readyState === WebSocket.OPEN) {
      try { socket.ping(); } catch {}
      sendJson(socket, { type: "heartbeat", timestamp: Date.now() });
    }
  }, BROADCASTER_WS_PING_MS);
  socket.once("close", () => clearInterval(pingTimer));

  if (!resumingExistingBroadcast) {
    live = false;
    broadcastMode = null;
  }

  socket.on("message", (data, isBinary) => {
    if (isBinary) {
      if (!live) return;

      // During a planned rotation the Broadcaster mirrors the same PCM frame
      // to both sockets. Commit the replacement only after that mirrored frame
      // arrives, and do not encode it twice when it is identical to the last frame
      // already accepted from the old socket.
      if (pendingBroadcaster === socket && broadcaster !== socket) {
        const previous = broadcaster;
        const raw = rawBuffer(data);
        const replacementPayload = pcmPayload(raw);
        const duplicateOfLastFrame =
          replacementPayload !== null &&
          lastPcmFrame !== null &&
          replacementPayload.length === lastPcmFrame.length &&
          replacementPayload.equals(lastPcmFrame);

        pendingBroadcaster = null;
        broadcaster = socket;
        broadcasterConnectedAt = new Date();
        console.info(`[USALB relay] broadcaster handoff committed on mirrored live PCM frame; duplicateFirstFrame=${duplicateOfLastFrame}; handoff=${SEAMLESS_HANDOFF_PROTOCOL}.`);

        if (!duplicateOfLastFrame) relay(raw);

        // The replacement is now authoritative, but do not close the old
        // socket yet. The Broadcaster waits for this acknowledgement before
        // aborting the old connection. That keeps the old transport alive
        // through the exact server-side handoff point.
        sendJson(socket, {
          type: "handoff-committed",
          protocol: SEAMLESS_HANDOFF_PROTOCOL,
          duplicateFirstFrame: duplicateOfLastFrame,
        });
        console.info("[USALB relay] handoff acknowledged to replacement; old broadcaster remains open until client closes it.");
      } else if (broadcaster === socket) {
        relay(rawBuffer(data));
      }
      return;
    }

    try {
      const message = JSON.parse(data.toString()) as {
        type?: string;
        codec?: string;
        mimeType?: string;
        timestamp?: number;
        pcmSampleRate?: number;
        pcmChannels?: number;
      };

      if (message.type === "heartbeat") {
        sendJson(socket, { type: "heartbeat", timestamp: Date.now() });
      } else if (message.type === "start") {
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
          if (!encoders.has(320) && !startEncoders()) {
            sendJson(socket, { type: "error", message: "Server audio encoder is unavailable." });
            reset();
            return;
          }
        }

        live = true;
        announceWsStatus();
        if (!resumingExistingBroadcast) {
          startedAt = new Date();
          lastAudioAt = null;
          totalBytes = 0;
        }
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

  socket.once("close", (code, reason) => {
    const closeReason = reason?.toString() || "";
    lastBroadcasterCloseAt = new Date();
    lastBroadcasterCloseCode = code;
    lastBroadcasterCloseReason = closeReason || null;
    const lifetimeMs = broadcasterConnectedAt ? Date.now() - broadcasterConnectedAt.getTime() : null;
    console.warn(`[USALB relay] broadcaster closed: code=${code} reason=${closeReason || "(none)"} lifetimeMs=${lifetimeMs ?? "unknown"} live=${live} listeners=${listeners.size} lastAudioAt=${lastAudioAt?.toISOString() ?? "none"}`);
    if (pendingBroadcaster === socket) {
      pendingBroadcaster = null;
      console.warn("[USALB relay] pending broadcaster replacement closed before first PCM frame; keeping current broadcaster.");
      return;
    }
    if (broadcaster !== socket) return;
    broadcaster = null;
    // Do not take the radio offline for a transient network/proxy drop.
    // Keep the encoder and listener connections alive for up to 30 seconds
    // so the broadcaster can reconnect without interrupting the station.
    if (live) {
      cancelBroadcasterDisconnectGrace();
      broadcasterDisconnectTimer = setTimeout(() => {
        broadcasterDisconnectTimer = null;
        if (!broadcaster) reset("broadcaster reconnect grace expired");
      }, BROADCASTER_RECONNECT_GRACE_MS);
    } else {
      reset();
    }
  });
  socket.once("error", () => {
    if (broadcaster !== socket) return;
    console.error("[USALB relay] broadcaster WebSocket error");
    try { socket.close(); } catch {}
  });
}

export function handleLiveIngestRequest(req: IncomingMessage, res: ServerResponse): boolean {
  const url = new URL(req.url ?? "", `http://${req.headers.host ?? "localhost"}`);
  if (req.method !== "POST" || url.pathname !== "/api/live/ingest") return false;

  const token = req.headers["x-broadcaster-token"]?.toString().trim() || "";
  if (!token) {
    res.statusCode = 401;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end("Broadcaster token required.");
    return true;
  }

  // Authenticate the long-lived ingest request against the same private
  // publish token issued by /api/broadcaster/pair. Pause the request while
  // the database lookup runs so no PCM bytes can be lost before listeners
  // are attached.
  req.pause();
  void (async () => {
    try {
      const devices = await db.select({ id: broadcasterDevicesTable.id })
        .from(broadcasterDevicesTable)
        .where(eq(broadcasterDevicesTable.publishToken, token))
        .limit(1);

      if (!devices[0]) {
        res.statusCode = 401;
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.end("Invalid broadcaster token.");
        req.resume();
        req.destroy();
        return;
      }

      if (httpBroadcaster && httpBroadcaster !== req) {
        // A replacement source starts on a clean PCM frame boundary.
        pcmPending = Buffer.alloc(0);
        try { httpBroadcaster.destroy(); } catch {}
      }

      cancelBroadcasterDisconnectGrace();

      const resumingExistingBroadcast = live && encoders.has(320);
      httpBroadcaster = req;
      httpBroadcasterResponse = res;
      broadcastMode = "pcm";
      pcmSampleRate = Math.round(Number(req.headers["x-usalb-sample-rate"]) || 44100);
      pcmChannels = Math.min(2, Math.max(1, Math.round(Number(req.headers["x-usalb-channels"]) || 2)));

      if (!encoders.has(320) && !startEncoders()) {
        res.statusCode = 503;
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.end("Server audio encoder is unavailable.");
        httpBroadcaster = null;
        httpBroadcasterResponse = null;
        req.resume();
        return;
      }

      if (!resumingExistingBroadcast) {
        live = true;
        startedAt = new Date();
        lastAudioAt = null;
        totalBytes = 0;
        announceWsStatus();
      } else {
        live = true;
      }

      recordIngestHeartbeat();

      res.writeHead(200, {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
        "Connection": "keep-alive",
      });
      res.flushHeaders?.();

      const disconnect = () => {
        if (httpBroadcaster !== req) return;
        httpBroadcaster = null;
        httpBroadcasterResponse = null;
        // Never carry a partial PCM packet from one broadcaster connection into the next.
        pcmPending = Buffer.alloc(0);
        if (live) {
          cancelBroadcasterDisconnectGrace();
          broadcasterDisconnectTimer = setTimeout(() => {
            broadcasterDisconnectTimer = null;
            if (!httpBroadcaster && !broadcaster) reset();
          }, BROADCASTER_RECONNECT_GRACE_MS);
        } else {
          reset();
        }
      };

      req.on("data", (chunk: Buffer) => {
        if (!live || httpBroadcaster !== req) return;
        relay(chunk);
      });
      req.once("end", disconnect);
      req.once("close", disconnect);
      req.once("aborted", disconnect);
      req.once("error", disconnect);
      res.once("close", () => {
        if (httpBroadcaster === req) disconnect();
      });
      req.resume();
    } catch (error) {
      console.error("[USALB ingest auth]", error);
      if (!res.headersSent) {
        res.statusCode = 503;
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.end("Broadcaster authentication service unavailable.");
      }
      req.resume();
    }
  })();

  return true;
}

export function getLiveSnapshot() {
  return {
    streaming: live && lastAudioAt !== null,
    connected: broadcaster !== null || httpBroadcaster !== null,
    listenerCount: listeners.size,
    contentType: live ? "audio/mpeg" : null,
    bitrateKbps: live ? 320 : null,
    qualities: live ? [320] : [],
    startedAt,
    lastAudioAt,
    totalBytes,
    encodedChunks,
    encoderRunning: encoders.has(320) && !encoders.get(320)!.process.killed,
    encoderStartedAt,
    sampleRate: 44100,
    channels: 2,
    audioFlow: lastAudioAt ? Date.now() - lastAudioAt.getTime() < 3000 : false,
    broadcasterConnectedAt,
    lastBroadcasterCloseAt,
    lastBroadcasterCloseCode,
    lastBroadcasterCloseReason,
    lastResetReason,
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

  const listenerId = ++listenerSequence;
  listeners.set(res, selectedQuality);
  listenerIds.set(res, listenerId);
  console.info(`[USALB relay] listener connected: id=${listenerId} quality=${selectedQuality} listeners=${listeners.size} recentBytes=${encoder.recentBytes}`);
  res.socket?.setKeepAlive(true, 30_000);
  res.socket?.setNoDelay(true);

  for (const chunk of encoder.recentChunks) {
    if (!res.writableEnded) res.write(chunk);
  }

  const cleanup = () => {
    if (!listenerIds.has(res)) return;
    const id = listenerIds.get(res)!;
    listenerIds.delete(res);
    listeners.delete(res);
    console.info(`[USALB relay] listener disconnected: id=${id} listeners=${listeners.size} writableEnded=${res.writableEnded} destroyed=${res.destroyed}`);
  };
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

    // Explicitly disable Node's idle socket timeout on the upgraded broadcaster
    // connection. The broadcaster is intentionally long-lived.
    const tcpSocket = socket as Socket;
    tcpSocket.setTimeout(0);
    tcpSocket.setKeepAlive(true, 30_000);
    tcpSocket.setNoDelay(true);

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
