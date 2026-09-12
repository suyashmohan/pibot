import { integer, sqliteTable, text, index } from "drizzle-orm/sqlite-core";

/**
 * Web-side session row. Each row maps 1:1 to a pi RPC subprocess
 * (spawned in `cwd`) and to pi's own session file on disk.
 */
export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  name: text("name").notNull().default("New session"),
  cwd: text("cwd").notNull(),
  provider: text("provider"),
  modelId: text("model_id"),
  thinkingLevel: text("thinking_level"),
  piSessionId: text("pi_session_id"),
  piSessionFile: text("pi_session_file"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

/** Cached copy of pi messages (pi's JSONL file is the source of truth). */
export const messages = sqliteTable(
  "messages",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    contentJson: text("content_json").notNull().default("[]"),
    rawJson: text("raw_json").notNull().default("{}"),
    timestamp: integer("timestamp").notNull(),
  },
  (t) => [index("messages_session_idx").on(t.sessionId)],
);

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export type SessionRow = typeof sessions.$inferSelect;
export type MessageRow = typeof messages.$inferSelect;
