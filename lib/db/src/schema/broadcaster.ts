import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export const broadcasterDevicesTable = pgTable("broadcaster_devices", {
  id: serial("id").primaryKey(),
  deviceId: text("device_id").notNull().unique(),
  publishToken: text("publish_token").notNull().unique(),
  displayName: text("display_name").notNull().default("USALB Broadcaster"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
});