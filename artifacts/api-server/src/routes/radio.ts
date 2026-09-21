import { desc, eq } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  CreateChatMessageBody,
  CreateChatMessageResponse,
  DeleteAdminChatMessageParams,
  GetAdminDiagnosticsResponse,
  GetChatResponse,
  GetListenersResponse,
  GetNowPlayingResponse,
  GetStationResponse,
  GetStreamStatusResponse,
  UpdateAdminNowPlayingBody,
  UpdateAdminNowPlayingResponse,
  UpdateAdminSettingsBody,
  UpdateAdminSettingsResponse,
} from "@workspace/api-zod";
import { db, chatMessagesTable, mutedUsersTable, nowPlayingTable, stationSettingsTable } from "@workspace/db";
import { getBroadcasterSnapshot, getListenerCount, broadcast } from "../lib/radio-state";
import { getLiveSnapshot, handleLiveStreamRequest } from "../lib/live-relay";

const router: IRouter = Router();
const chatRate = new Map<string, number>();

function configuredStreamUrl(storedUrl: string): string {
  return process.env.PUBLIC_RADIO_STREAM_URL || "/api/radio-stream";
}

function stationResponse(station: typeof stationSettingsTable.$inferSelect) {
  return GetStationResponse.parse({
    name: station.name,
    slogan: station.slogan,
    genre: station.genre,
    logoUrl: station.logoUrl,
    streamUrl: configuredStreamUrl(station.streamUrl),
    chatEnabled: station.chatEnabled,
    socialLinks: station.socialLinks,
  });
}

function nowPlayingResponse(track: typeof nowPlayingTable.$inferSelect) {
  return GetNowPlayingResponse.parse({
    artist: track.artist,
    title: track.title,
    artworkUrl: track.artworkUrl,
    genre: track.genre,
    startedAt: track.startedAt,
  });
}

router.get("/station", async (_req, res): Promise<void> => {
  const [station] = await db.select().from(stationSettingsTable).limit(1);
  if (!station) {
    res.status(503).json({ error: "Station settings are not initialized" });
    return;
  }
  res.json(stationResponse(station));
});

router.get("/now-playing", async (_req, res): Promise<void> => {
  const [track] = await db.select().from(nowPlayingTable).limit(1);
  if (!track) {
    res.status(503).json({ error: "Now playing is not initialized" });
    return;
  }
  res.json(nowPlayingResponse(track));
});

router.get("/listeners", (_req, res): void => {
  res.json(GetListenersResponse.parse({ count: getListenerCount() }));
});

router.get("/live/status", (_req, res): void => {
  res.json({ live: getLiveSnapshot().streaming });
});

router.get("/stream-status", async (_req, res): Promise<void> => {
  const [station] = await db.select().from(stationSettingsTable).limit(1);
  const streamUrl = configuredStreamUrl(station?.streamUrl ?? "");
  const [track] = await db.select().from(nowPlayingTable).limit(1);
  const heartbeat = getBroadcasterSnapshot();
  const stream = getLiveSnapshot();
  const broadcasterConnected = heartbeat.connected || stream.connected;
  const isLive = stream.streaming;
  const state = !streamUrl
    ? "OFFLINE"
    : isLive
      ? "LIVE"
      : heartbeat.status === "RECONNECTING"
        ? "RECONNECTING"
        : broadcasterConnected
          ? "CONNECTING"
          : "OFFLINE";

  res.json(GetStreamStatusResponse.parse({
    state,
    isLive,
    broadcasterConnected,
    listenerCount: getListenerCount() + stream.listenerCount,
    uptimeSeconds: stream.startedAt ? Math.max(0, Math.floor((Date.now() - stream.startedAt.getTime()) / 1000)) : 0,
    lastHeartbeat: heartbeat.receivedAt.getTime() > 0 ? heartbeat.receivedAt : null,
    streamUrl,
    contentType: stream.contentType ?? heartbeat.contentType,
    bitrateKbps: heartbeat.bitrateKbps,
    sampleRate: heartbeat.sampleRate,
    currentTrack: track ? nowPlayingResponse(track) : null,
  }));
});

router.get("/chat", async (_req, res): Promise<void> => {
  const messages = await db.select().from(chatMessagesTable).orderBy(desc(chatMessagesTable.createdAt)).limit(80);
  res.json(GetChatResponse.parse(messages.reverse()));
});

router.post("/chat", async (req, res): Promise<void> => {
  const parsed = CreateChatMessageBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const key = `${req.ip}:${parsed.data.nickname.toLowerCase()}`;
  const lastSent = chatRate.get(key) ?? 0;
  if (Date.now() - lastSent < 4_000) {
    res.status(429).json({ error: "Please wait a few seconds before sending another message" });
    return;
  }
  const [muted] = await db.select({ id: mutedUsersTable.id }).from(mutedUsersTable).where(eq(mutedUsersTable.nickname, parsed.data.nickname)).limit(1);
  if (muted) {
    res.status(403).json({ error: "This nickname is muted" });
    return;
  }
  const nickname = parsed.data.nickname.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  const message = parsed.data.message.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  const [created] = await db.insert(chatMessagesTable).values({ nickname, message }).returning();
  chatRate.set(key, Date.now());
  const response = CreateChatMessageResponse.parse(created);
  broadcast({ type: "chat", message: response });
  res.status(201).json(response);
});

router.put("/admin/settings", async (req, res): Promise<void> => {
  const parsed = UpdateAdminSettingsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [existing] = await db.select().from(stationSettingsTable).limit(1);
  if (!existing) {
    res.status(503).json({ error: "Station settings are not initialized" });
    return;
  }
  const [updated] = await db.update(stationSettingsTable).set({ ...parsed.data, updatedAt: new Date() }).where(eq(stationSettingsTable.id, existing.id)).returning();
  res.json(UpdateAdminSettingsResponse.parse(stationResponse(updated)));
});

router.put("/admin/now-playing", async (req, res): Promise<void> => {
  const parsed = UpdateAdminNowPlayingBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [existing] = await db.select().from(nowPlayingTable).limit(1);
  if (!existing) {
    res.status(503).json({ error: "Now playing is not initialized" });
    return;
  }
  const [updated] = await db.update(nowPlayingTable).set({ ...parsed.data, startedAt: new Date(), updatedAt: new Date() }).where(eq(nowPlayingTable.id, existing.id)).returning();
  const response = UpdateAdminNowPlayingResponse.parse(nowPlayingResponse(updated));
  broadcast({ type: "now-playing", track: response });
  res.json(response);
});

router.delete("/admin/chat/:id", async (req, res): Promise<void> => {
  const parsed = DeleteAdminChatMessageParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  await db.delete(chatMessagesTable).where(eq(chatMessagesTable.id, parsed.data.id));
  broadcast({ type: "chat-deleted", id: parsed.data.id });
  res.sendStatus(204);
});

router.post("/admin/chat/clear", async (_req, res): Promise<void> => {
  await db.delete(chatMessagesTable);
  broadcast({ type: "chat-cleared" });
  res.sendStatus(204);
});

router.get("/admin/diagnostics", async (_req, res): Promise<void> => {
  const [station] = await db.select().from(stationSettingsTable).limit(1);
  const streamUrl = configuredStreamUrl(station?.streamUrl ?? "");
  const heartbeat = getBroadcasterSnapshot();
  const stream = getLiveSnapshot();
  const audioData = stream.streaming;
  const broadcasterConnected = heartbeat.connected || stream.connected;
  const checks = [
    { name: "Broadcaster", status: broadcasterConnected ? "pass" : "fail", detail: broadcasterConnected ? "Authenticated broadcaster connection is active" : "No recent broadcaster connection" },
    { name: "Stream server", status: "pass", detail: "USALB Radio is accepting the broadcaster connection" },
    { name: "Audio data", status: audioData ? "pass" : "fail", detail: audioData ? `${stream.totalBytes} bytes received from the broadcaster` : "No audio bytes received yet" },
    { name: "Public stream", status: audioData ? "pass" : "fail", detail: audioData ? `${stream.listenerCount} listener stream connections can receive the relay` : `Waiting for audio at ${streamUrl}` },
    { name: "Mobile compatibility", status: stream.contentType?.startsWith("audio/") ? "pass" : "warn", detail: stream.contentType ? `Content-Type: ${stream.contentType}` : "No audio Content-Type received" },
  ] as const;
  res.json(GetAdminDiagnosticsResponse.parse({ checks }));
});

export default router;