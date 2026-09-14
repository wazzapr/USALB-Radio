import { boolean, integer, jsonb, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const stationSettingsTable = pgTable("station_settings", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().default("USALB Radio"),
  slogan: text("slogan").notNull().default("Broadcasting from wherever the music is."),
  genre: text("genre").notNull().default("Open format"),
  logoUrl: text("logo_url"),
  streamUrl: text("stream_url").notNull().default(""),
  chatEnabled: boolean("chat_enabled").notNull().default(true),
  socialLinks: jsonb("social_links").$type<Record<string, string>>().notNull().default({}),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertStationSettingsSchema = createInsertSchema(stationSettingsTable).omit({ id: true, updatedAt: true });
export type InsertStationSettings = z.infer<typeof insertStationSettingsSchema>;
export type StationSettings = typeof stationSettingsTable.$inferSelect;