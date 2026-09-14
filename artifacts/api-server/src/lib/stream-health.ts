import { logger } from "./logger";

export type StreamProbe = {
  reachable: boolean;
  hasAudioData: boolean;
  contentType: string | null;
  detail: string;
};

export async function probePublicStream(streamUrl: string): Promise<StreamProbe> {
  if (!streamUrl) {
    return {
      reachable: false,
      hasAudioData: false,
      contentType: null,
      detail: "RADIO_STREAM_URL is not configured",
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4_000);

  try {
    const response = await fetch(streamUrl, {
      headers: { Accept: "audio/mpeg,audio/aac,audio/*" },
      signal: controller.signal,
    });
    const contentType = response.headers.get("content-type");
    if (!response.ok || !response.body) {
      return {
        reachable: false,
        hasAudioData: false,
        contentType,
        detail: `Stream responded with HTTP ${response.status}`,
      };
    }

    const reader = response.body.getReader();
    const firstChunk = await reader.read();
    await reader.cancel();
    const hasAudioData = Boolean(firstChunk.value && firstChunk.value.byteLength > 0);
    return {
      reachable: true,
      hasAudioData,
      contentType,
      detail: hasAudioData ? "Audio bytes received" : "Stream returned no audio bytes",
    };
  } catch (error) {
    logger.debug({ error, streamUrl }, "Public stream probe failed");
    return {
      reachable: false,
      hasAudioData: false,
      contentType: null,
      detail: error instanceof Error && error.name === "AbortError" ? "Stream probe timed out" : "Stream could not be reached",
    };
  } finally {
    clearTimeout(timeout);
  }
}