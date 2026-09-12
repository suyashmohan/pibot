import { afterAll, describe, expect, test } from "bun:test";
import { dirExists, hasSqlMigrations } from "@/lib/files";
import { makeTempDir, removeTempDir } from "./helpers/test-env";

const dirs: string[] = [];
afterAll(async () => {
  for (const d of dirs.splice(0)) await removeTempDir(d);
});

describe("dirExists", () => {
  test("true for directories, false for missing paths and files", async () => {
    expect(await dirExists("/tmp")).toBe(true);
    expect(await dirExists("/nope-missing-dir-pibot-xyz")).toBe(false);
    // this test file itself is a file, not a directory
    expect(await dirExists(new URL("./files.test.ts", import.meta.url).pathname)).toBe(false);
  });
});

describe("hasSqlMigrations", () => {
  test("detects *.sql files", async () => {
    const withSql = await makeTempDir();
    const empty = await makeTempDir();
    dirs.push(withSql, empty);
    await Bun.write(`${withSql}/0001_init.sql`, "select 1;");
    expect(await hasSqlMigrations(withSql)).toBe(true);
    expect(await hasSqlMigrations(empty)).toBe(false);
    expect(await hasSqlMigrations("/nope-missing-dir-pibot-xyz")).toBe(false);
  });
});
