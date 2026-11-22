import { Router } from "express";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  fetchStreamTarget,
  openFreshRadioAudio,
  wakeRadioStation,
} from "../lib/radio-provider";

const streamRouter = Router();

// Resolve the provider's current MP3 mount on every request. This is an audio
// redirect, not an embedded station webpage or a transcoded relay.
streamRouter.get("/stream-direct", async (req, res): Promise<void> => {
  try {
    const target = await fetchStreamTarget();
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.redirect(302, target.url);
  } catch (err) {
    req.log.warn({ err }, "Unable to resolve the direct radio stream");
    res.status(503).json({ error: "Radio stream is unavailable" });
  }
});

// Raw MP3 relay retained for diagnostics or clients that cannot follow redirects.
streamRouter.get("/stream", async (req, res) => {
  let audioConnection: Awaited<ReturnType<typeof openFreshRadioAudio>> | null = null;
  try {
    audioConnection = await openFreshRadioAudio();
  } catch (err) {
    req.log.warn({ err }, "Radio stream is not returning audio");
    res.status(502).json({ error: "Radio stream is unavailable" });
    return;
  }

  const controller = audioConnection.controller;
  const clientDisconnected = () => {
    if (!controller.signal.aborted) controller.abort();
  };
  req.once("aborted", clientDisconnected);
  const handleResponseClose = () => {
    if (!res.writableEnded) clientDisconnected();
  };
  res.once("close", handleResponseClose);

  res.status(200);
  res.setHeader("Content-Type", audioConnection.response.headers.get("content-type") ?? "audio/mpeg");
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  res.setHeader("Accept-Ranges", "none");
  try {
    const body = audioConnection.response.body;
    if (!body) {
      res.end();
      return;
    }
    await pipeline(Readable.fromWeb(body as ReadableStream<Uint8Array>), res);
  } catch (err) {
    if (!controller.signal.aborted) {
      req.log.warn({ err }, "Radio audio relay ended unexpectedly");
    }
  } finally {
    req.off("aborted", clientDisconnected);
    res.off("close", handleResponseClose);
  }
});

streamRouter.get("/stream-warmup", async (req, res) => {
  try {
    const target = await fetchStreamTarget();
    await wakeRadioStation(target.cookie);
    res.json({ ready: true });
  } catch (err) {
    req.log.warn({ err }, "Unable to warm the radio station");
    res.status(503).json({ ready: false, error: "Radio station is not ready" });
  }
});

streamRouter.get("/stream-url", async (req, res) => {
  try {
    const target = await fetchStreamTarget();
    await wakeRadioStation(target.cookie);
    res.json({ url: target.url, source: "live" });
  } catch (err) {
    req.log.warn({ err }, "Unable to resolve the live radio URL");
    res.status(503).json({ error: "Radio stream is unavailable" });
  }
});

export default streamRouter;
