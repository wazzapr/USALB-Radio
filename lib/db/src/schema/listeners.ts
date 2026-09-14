import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export const listenerSessionsTable = pgTable("listener_sessions", {
  id: serial("id").primaryKey(),
  listenerId: text("listener_id").notNull().unique(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});