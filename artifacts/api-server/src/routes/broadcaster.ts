import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { Router, type IRouter, type Request } from "express";
import {
  BroadcasterIntentBody,
  BroadcasterIntentResponse,
  BroadcasterTelemetryBody,
  GetBroadcasterCommandsResponse,
  PairBroadcasterBody,
  PairBroadcasterResponse,
} from "@workspace/api-zod";
import { broadcasterDevicesTable, db, streamEventsTable } from "@workspace/db";
import { recordBroadcasterHeartbeat } from "../lib/radio-state";
import { beginIngest, endIngest, getStreamSnapshot, ingestChunk, openListener } from "../lib/stream-hub";

const router: IRouter = Router();

function requestBaseUrl(req: Request): string {
  const forwardedProto = req.header("x-forwarded-proto")?.split(",")[0]?.trim();
  const protocol = forwardedProto || req.protocol;
  return `${protocol}://${req.get("host")}`;
}

function secureEquals(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function tokenFromRequest(req: Request): string | null {
  const authorization = req.header("authorization");
  if (authorization?.toLowerCase().startsWith("bearer ")) return authorization.slice(7).trim();
  return req.header("x-broadcaster-token") || null;
}

async function authenticateBroadcaster(req: Request) {
  const token = tokenFromRequest(req);
  if (!token) return null;
  const devices = await db.select().from(broadcasterDevicesTable);
  const device = devices.find((candidate) => secureEquals(candidate.publishToken, token));
  if (device) {
    await db.update(broadcasterDevicesTable).set({ lastSeenAt: new Date() }).where(eq(broadcasterDevicesTable.id, device.id));
  }
  return device ?? null;
}

router.post("/broadcaster/pair", async (req, res): Promise<void> => {
  const parsed = PairBroadcasterBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const expectedCode = process.env.BROADCASTER_PAIRING_CODE;
  if (!expectedCode) {
    res.status(503).json({ error: "Broadcaster pairing is not configured on this server" });
    return;
  }
  if (!secureEquals(parsed.data.code, expectedCode)) {
    res.status(401).json({ error: "Invalid pairing code" });
    return;
  }

  const deviceId = parsed.data.deviceId || randomUUID();
  const deviceName = parsed.data.deviceName || "USALB Broadcaster";
  const [existing] = await db.select().from(broadcasterDevicesTable).where(eq(broadcasterDevicesTable.deviceId, deviceId)).limit(1);
  const device = existing ?? (await db.insert(broadcasterDevicesTable).values({
    deviceId,
    publishToken: randomBytes(32).toString("hex"),
    displayName: deviceName,
  }).returning())[0];
  if (!device) {
    res.status(500).json({ error: "Could not create broadcaster credentials" });
    return;
  }

  const base = requestBaseUrl(req);
  res.json(PairBroadcasterResponse.parse({
    stationName: "USALB Radio",
    deviceId: device.deviceId,
    displayName: device.displayName,
    publishToken: device.publishToken,
    publishEndpoint: `${base}/api/radio-ingest`,
    publicStreamEndpoint: `${base}/api/radio-stream`,
    heartbeatEndpoint: `${base}/api/broadcaster/heartbeat`,
    telemetryEndpoint: `${base}/api/broadcaster/telemetry`,
    intentEndpoint: `${base}/api/broadcaster/intent`,
    commandsEndpoint: `${base}/api/broadcaster/commands`,
    format: "audio/mpeg; codec=mp3; 44100 Hz; stereo; 128 kbps",
  }));
});

router.get("/broadcaster/commands", async (req, res): Promise<void> => {
  const device = await authenticateBroadcaster(req);
  if (!device) {
    res.status(401).json({ error: "Broadcaster authentication required" });
    return;
  }
  res.json(GetBroadcasterCommandsResponse.parse({ deviceId: device.deviceId, commands: [] }));
});

router.post("/broadcaster/heartbeat", async (req, res): Promise<void> => {
  const device = await authenticateBroadcaster(req);
  const legacyKey = process.env.BROADCASTER_KEY;
  if (!device && (!legacyKey || req.header("x-broadcaster-key") !== legacyKey)) {
    res.status(401).json({ error: "Broadcaster authentication required" });
    return;
  }
  const parsed = BroadcasterTelemetryBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const status = parsed.data.status === "RECONNECTING" ? "RECONNECTING" : parsed.data.status === "DISCONNECTED" ? "DISCONNECTED" : parsed.data.status === "CONNECTED" ? "CONNECTED" : "STREAMING";
  recordBroadcasterHeartbeat({
    status,
    bitrateKbps: parsed.data.bitrateKbps ?? null,
    sampleRate: parsed.data.sampleRate ?? null,
    contentType: parsed.data.contentType ?? null,
  });
  await db.insert(streamEventsTable).values({
    status,
    bitrateKbps: parsed.data.bitrateKbps?.toString() ?? null,
    sampleRate: parsed.data.sampleRate ?? null,
    contentType: parsed.data.contentType ?? null,
    detail: parsed.data.detail ?? "Broadcaster heartbeat",
  });
  res.status(204).end();
});

router.post("/broadcaster/telemetry", async (req, res): Promise<void> => {
  const device = await authenticateBroadcaster(req);
  if (!device) {
    res.status(401).json({ error: "Broadcaster authentication required" });
    return;
  }
  const parsed = BroadcasterTelemetryBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  await db.insert(streamEventsTable).values({
    status: parsed.data.status ?? "TELEMETRY",
    bitrateKbps: parsed.data.bitrateKbps?.toString() ?? null,
    sampleRate: parsed.data.sampleRate ?? null,
    contentType: parsed.data.contentType ?? null,
    detail: parsed.data.detail ?? (parsed.data.bytesSent == null ? "Broadcaster telemetry" : `Broadcaster sent ${parsed.data.bytesSent} bytes`),
  });
  res.status(204).end();
});

router.post("/broadcaster/intent", async (req, res): Promise<void> => {
  const device = await authenticateBroadcaster(req);
  if (!device) {
    res.status(401).json({ error: "Broadcaster authentication required" });
    return;
  }
  const parsed = BroadcasterIntentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  await db.insert(streamEventsTable).values({
    status: "INTENT",
    detail: `${parsed.data.intent}${parsed.data.payload ? ` ${JSON.stringify(parsed.data.payload)}` : ""}`.slice(0, 500),
  });
  res.json(BroadcasterIntentResponse.parse({ accepted: true, intent: parsed.data.intent }));
});

router.post("/radio-ingest", async (req, res): Promise<void> => {
  const device = await authenticateBroadcaster(req);
  if (!device) {
    res.status(401).json({ error: "Broadcaster authentication required" });
    return;
  }
  const contentType = req.header("content-type")?.split(";")[0].trim() || "audio/mpeg";
  if (!contentType.startsWith("audio/") && contentType !== "application/octet-stream") {
    res.status(415).json({ error: "Send encoded audio with an audio/* Content-Type" });
    return;
  }
  if (!beginIngest(req, contentType)) {
    res.status(409).json({ error: "Another broadcaster is already streaming" });
    return;
  }
  res.writeHead(200, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
    Connection: "keep-alive",
    "Transfer-Encoding": "chunked",
  });
  res.write("USALB STREAMING\n");
  recordBroadcasterHeartbeat({ status: "STREAMING", bitrateKbps: null, sampleRate: null, contentType });
  req.on("data", (chunk: Buffer) => {
    ingestChunk(chunk);
    recordBroadcasterHeartbeat({ status: "STREAMING", bitrateKbps: null, sampleRate: null, contentType });
  });
  req.on("end", () => endIngest(req));
  req.on("aborted", () => endIngest(req));
  req.on("close", () => endIngest(req));
  res.on("close", () => endIngest(req));
});

router.get("/radio-stream", (_req, res): void => {
  const snapshot = getStreamSnapshot();
  if (!snapshot.streaming) {
    res.status(503).json({ error: "Radio is offline" });
    return;
  }
  if (!openListener(res)) {
    res.status(503).json({ error: "Radio stream is not ready" });
  }
});

export default router;
