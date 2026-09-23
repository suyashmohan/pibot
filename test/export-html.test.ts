/**
 * Session-export staging helpers.
 *
 * pi's `export_html` defaults to writing `<cwd>/pi-session-*.html`, which
 * dumped an export into the user's project on every click. PiBot now stages
 * the export in the OS temp dir and the browser downloads it from a
 * same-origin GET. These pure helpers are the single source of truth for the
 * temp path + download URL, so the server and the client cannot drift.
 */
import { describe, expect, test } from "bun:test";
import {
  EXPORT_FILE_PREFIX,
  EXPORT_TEMP_DIR,
  exportDownloadUrl,
  exportFileName,
  exportTempPath,
} from "@/lib/export-html";

describe("export file naming", () => {
  test("is deterministic per session and lives under the temp dir", () => {
    expect(EXPORT_FILE_PREFIX).toBe("pibot-export-");
    expect(EXPORT_TEMP_DIR).toBe("/tmp");
    expect(exportFileName("abc123")).toBe("pibot-export-abc123.html");
    expect(exportTempPath("abc123")).toBe("/tmp/pibot-export-abc123.html");
  });

  test("sanitizes hostile ids so the name can never escape the temp dir", () => {
    const name = exportFileName("../../etc/passwd");
    expect(name.startsWith(EXPORT_FILE_PREFIX)).toBe(true);
    expect(name.endsWith(".html")).toBe(true);
    expect(name).not.toContain("/");
    expect(name).not.toContain("\\");
    expect(exportTempPath("../../etc/passwd").startsWith("/tmp/")).toBe(true);
  });

  test("falls back to a plain name for an empty id", () => {
    expect(exportFileName("")).toBe("pibot-export-session.html");
  });

  test("keeps nanoid punctuation (ids may start/end with - or _)", () => {
    // Trailing dashes are common nanoid shapes; stripping them made two
    // distinct session ids share one staged file (caught in an HTTP smoke
    // test).
    expect(exportFileName("vvFyLtbfX8I-")).toBe("pibot-export-vvFyLtbfX8I-.html");
    expect(exportFileName("-abc_")).toBe("pibot-export--abc_.html");
    expect(exportFileName("a.b")).toBe("pibot-export-a.b.html");
  });
});

describe("export download URL", () => {
  test("points at the session export route", () => {
    expect(exportDownloadUrl("abc123")).toBe("/api/sessions/abc123/export");
  });

  test("encodes the session id", () => {
    expect(exportDownloadUrl("a/b c")).toBe("/api/sessions/a%2Fb%20c/export");
  });
});
