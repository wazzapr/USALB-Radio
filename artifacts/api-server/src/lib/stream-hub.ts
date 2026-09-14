import type { IncomingMessage, ServerResponse } from "node:http";
import { logger } from "./logger";

type Listener = ServerResponse;

let activeIngest: IncomingMessage | null = null;
let activeIngestStartedAt: Date | null = null;
let lastAudioAt: Date | null = null;
let totalBytes = 0;
let activeContentType = "audio/mpeg";
const listeners = new Set<Listener>();

export function beginIngest(request: IncomingMessage, contentType = "audio/mpeg"): boolean {
  if (activeIngest) return false;
  activeIngest = request;
  activeIngestStartedAt = new Date();
  lastAudioAt = null;
  totalBytes = 0;
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
  activeIngestStartedAt = null;
  lastAudioAt = null;
  activeContentType = "audio/mpeg";
  for (const listener of listeners) {
    if (!listener.writableEnded && !listener.destroyed) listener.end();
  }
  listeners.clear();
}

export function openListener(response: ServerResponse): boolean {
  if (!activeIngest || !lastAudioAt || Date.now() - lastAudioAt.getTime() > 15_000) return false;
  response.writeHead(200, {
    "Content-Type": activeContentType,
    "Cache-Control": "no-store, no-cache, must-revalidate",
    Pragma: "no-cache",
    Connection: "keep-alive",
    "Transfer-Encoding": "chunked",
    "Access-Control-Allow-Origin": "*",
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
    connected: activeIngest !== null,
    streaming: activeIngest !== null && lastAudioAt !== null && Date.now() - lastAudioAt.getTime() <= 15_000,
    startedAt: activeIngestStartedAt,
    lastAudioAt,
    totalBytes,
    listenerCount: listeners.size,
    contentType: activeContentType,
  };
}