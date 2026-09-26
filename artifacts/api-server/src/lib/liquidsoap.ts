import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { get as httpGet, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

let processRef: ChildProcessWithoutNullStreams | null = null;
let starting: Promise<boolean> | null = null;
let listenerCount = 0;

function scriptPath(): string {
  return resolve(process.cwd(), "liquidsoap", "radio.liq");
}

export function liquidsoapPassword(): string {
  return process.env.USALB_LIQUIDSOAP_SOURCE_PASSWORD?.trim() || "usalb-internal-source";
}

export async function ensureLiquidsoap(): Promise<boolean> {
  if (process.env.DISABLE_LIQUIDSOAP === "1") return false;
  if (processRef && processRef.exitCode === null && !processRef.killed) return true;
  if (starting) return starting;

  starting = (async () => {
    const script = scriptPath();
    if (!existsSync(script)) {
      console.error("[USALB Liquidsoap] script not found:", script);
      return false;
    }

    const child = spawn(process.env.LIQUIDSOAP_PATH || "liquidsoap", ["-v", script], {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    processRef = child;
    child.stdout.on("data", (chunk) => console.log(`[Liquidsoap] ${chunk.toString().trimEnd()}`));
    child.stderr.on("data", (chunk) => console.error(`[Liquidsoap] ${chunk.toString().trimEnd()}`));
    child.once("exit", (code, signal) => {
      console.error(`[USALB Liquidsoap] exited code=${code ?? "null"} signal=${signal ?? "null"}`);
      if (processRef === child) processRef = null;
    });
    child.once("error", (error) => {
      console.error("[USALB Liquidsoap] failed to start:", error.message);
      if (processRef === child) processRef = null;
    });

    await new Promise((resolveDelay) => setTimeout(resolveDelay, 1200));
    return processRef === child && child.exitCode === null;
  })().finally(() => {
    starting = null;
  });

  return starting;
}

export function liquidsoapRunning(): boolean {
  return !!processRef && processRef.exitCode === null && !processRef.killed;
}

export function liquidsoapListenerCount(): number {
  return listenerCount;
}

export function stopLiquidsoap(): void {
  if (!processRef) return;
  try { processRef.kill("SIGTERM"); } catch {}
  processRef = null;
}

export function handleLiquidsoapStreamRequest(req: IncomingMessage, res: ServerResponse): boolean {
  const url = new URL(req.url ?? "", `http://${req.headers.host ?? "localhost"}`);
  if (req.method !== "GET" || !["/api/radio-stream", "/api/live/stream", "/api/live/stream-320"].includes(url.pathname)) return false;

  if (!liquidsoapRunning()) {
    res.statusCode = 503;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.end("USALB Liquidsoap stream is unavailable.");
    return true;
  }

  const upstream = httpGet("http://127.0.0.1:8006/stream", (response) => {
    res.statusCode = response.statusCode ?? 502;
    for (const [key, value] of Object.entries(response.headers)) {
      if (value !== undefined) res.setHeader(key, value as string | string[]);
    }
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.setHeader("X-Accel-Buffering", "no");
    res.socket?.setNoDelay(true);
    res.flushHeaders?.();

    listenerCount += 1;
    response.once("close", () => {
      listenerCount = Math.max(0, listenerCount - 1);
    });

    response.pipe(res);
    response.on("error", () => {
      if (!res.writableEnded) res.destroy();
    });
  });

  upstream.on("error", (error) => {
    console.error("[USALB Liquidsoap listener]", error.message);
    if (!res.headersSent) {
      res.statusCode = 503;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end("USALB Liquidsoap stream is unavailable.");
    } else {
      res.destroy();
    }
  });

  req.on("close", () => {
    if (!upstream.destroyed) upstream.destroy();
  });

  return true;
}
