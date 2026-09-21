import type { IncomingMessage, ServerResponse } from "node:http";
import { logger } from "./logger";

type Listener = ServerResponse;

let activeIngest: IncomingMessage | null = null;
let activeIngestStartedAt: Date | null = null;
let lastAudioAt: Date | null = null;
let totalBytes = 0;
let activeContentType = "audio/mpeg";
let activeBroadcasterId: string | null = null;
let idleTimer: NodeJS.Timeout | null = null;
const listeners = new Set<Listener>();

export function beginIngest(
  request: IncomingMessage,
  contentType = "audio/mpeg",
  broadcasterId: string,
): boolean {
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }

  if (activeBroadcasterId && activeBroadcasterId !== broadcasterId) return false;

  if (!activeIngest) {
    activeIngestStartedAt = new Date();
    lastAudioAt = null;
    totalBytes = 0;
    activeContentType = contentType;
    activeBroadcasterId = broadcasterId;
  }

  activeIngest = request;
  activeContentType = contentType;
  return true;
}

export function ingestChunk(chunk: Buffer): void {
  if (!activeIngest) return;
  lastAudioAt = new Date();
  totalBytes += chunk.byteLength;

  for (const listener of listeners) {
    if (listener.writableEnded || listener.destroyed) {
      listeners.delete(listener);
      continue;
    }
    try {
      listener.write(chunk);
    } catch (error) {
      logger.debug({ error }, "Could not relay an audio chunk");
      listeners.delete(listener);
    }
  }
}

export function endIngest(request: IncomingMessage): void {
  if (activeIngest !== request) return;

  activeIngest = null;

  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (activeIngest) return;
    activeBroadcasterId = null;
    activeIngestStartedAt = null;
    lastAudioAt = null;
    activeContentType = "audio/mpeg";

    for (const listener of listeners) {
      if (!listener.writableEnded && !listener.destroyed) listener.end();
    }
    listeners.clear();
    idleTimer = null;
  }, 5_000);
}

export function openListener(response: ServerResponse): boolean {
  if (!activeBroadcasterId) return false;

  response.writeHead(200, {
    "Content-Type": activeContentType,
    "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
    Pragma: "no-cache",
    "Accept-Ranges": "none",
    "X-Accel-Buffering": "no",
    "Access-Control-Allow-Origin": "*",
    Connection: "keep-alive",
  });
  response.flushHeaders?.();

  listeners.add(response);

  const remove = () => listeners.delete(response);
  response.on("close", remove);
  response.on("error", remove);

  return true;
}

export function getStreamSnapshot() {
  return {
    connected: activeBroadcasterId !== null,
    streaming: activeBroadcasterId !== null && lastAudioAt !== null && Date.now() - lastAudioAt.getTime() <= 15_000,
    startedAt: activeIngestStartedAt,
    lastAudioAt,
    totalBytes,
    listenerCount: listeners.size,
    contentType: activeContentType,
  };
}
