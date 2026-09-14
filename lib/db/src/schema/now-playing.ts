import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const nowPlayingTable = pgTable("now_playing", {
  id: serial("id").primaryKey(),
  artist: text("artist").notNull().default("USALB Radio"),
  title: text("title").notNull().default("Live Broadcast"),
  artworkUrl: text("artwork_url"),
  genre: text("genre").notNull().default("Open format"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertNowPlayingSchema = createInsertSchema(nowPlayingTable).omit({ id: true, updatedAt: true });
export type InsertNowPlaying = z.infer<typeof insertNowPlayingSchema>;
export type NowPlaying = typeof nowPlayingTable.$inferSelect;