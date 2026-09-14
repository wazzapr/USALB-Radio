import { db, nowPlayingTable, stationSettingsTable } from "@workspace/db";

export async function ensureSeedData(): Promise<void> {
  const station = await db.select({ id: stationSettingsTable.id }).from(stationSettingsTable).limit(1);
  if (station.length === 0) {
    await db.insert(stationSettingsTable).values({
      name: "USALB Radio",
      slogan: "Broadcasting from wherever the music is.",
      genre: "Open format",
      streamUrl: process.env.RADIO_STREAM_URL ?? "",
      chatEnabled: true,
      socialLinks: {},
    });
  }

  const nowPlaying = await db.select({ id: nowPlayingTable.id }).from(nowPlayingTable).limit(1);
  if (nowPlaying.length === 0) {
    await db.insert(nowPlayingTable).values({
      artist: "USALB Radio",
      title: "Live Broadcast",
      genre: "Open format",
    });
  }
}