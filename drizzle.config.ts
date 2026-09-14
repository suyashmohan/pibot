import type { Config } from "drizzle-kit";

const drizzleConfig = {
  schema: "./lib/db/schema.ts",
  out: "./drizzle",
  dialect: "sqlite",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "file:./data/pibot.db",
  },
} satisfies Config;

export default drizzleConfig;
