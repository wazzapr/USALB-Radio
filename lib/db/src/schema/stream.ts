import { integer, numeric, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export const streamEventsTable = pgTable("stream_events", {
  id: serial("id").primaryKey(),
  status: text("status").notNull(),
  bitrateKbps: numeric("bitrate_kbps", { precision: 8, scale: 2 }),
  sampleRate: integer("sample_rate"),
  contentType: text("content_type"),
  detail: text("detail"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});