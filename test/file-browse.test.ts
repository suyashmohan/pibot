/**
 * File-browser server layer: `listBrowseEntries` / `readTextPreview` in
 * `lib/files.ts` plus the three route handlers the panel talks to
 * (`browse`, `content`, `raw`).
 *
 * Runs against a real temp project on disk and a temp sqlite DB — never the
 * user's sessions and never a real pi process.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { sessions as sessionsTable } from "@/lib/db/schema";
import {
  BROWSE_ENTRY_LIMIT,
  listBrowseEntries,
  readTextPreview,
  resolveWithinRoot,
} from "@/lib/files";
import { GET as browseGET } from "@/app/api/sessions/[id]/files/browse/route";
import { GET as contentGET } from "@/app/api/sessions/[id]/files/content/route";
import { GET as rawGET } from "@/app/api/sessions/[id]/files/raw/route";
import { cleanupDbs, freshDb, makeTempDir, removeTempDir, uniqueId } from "./helpers/test-env";

const PNG_1PX = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==",
  ),
  (c) => c.charCodeAt(0),
);

let root = "";
let sessionId = "";
const README_SRC = "# Hello\n\n```ts\nconst x = 1;\n```\n";

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}

function get(path: string): Request {
  return new Request(`http://localhost${path}`);
}

beforeAll(async () => {
  root = await makeTempDir();
  await Bun.write(`${root}/README.md`, README_SRC);
  await Bun.write(`${root}/notes.txt`, "plain notes\n");
  await Bun.write(`${root}/data.bin`, new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0x01, 0x02]));
  await Bun.write(`${root}/big.txt`, "x".repeat(5000));
  await Bun.write(`${root}/src/main.ts`, "export const answer = 42;\n");
  await Bun.write(`${root}/src/util.ts`, "export const noop = () => {};\n");
  await Bun.write(`${root}/docs/guide.md`, "## Guide\n");
  await Bun.write(`${root}/images/pic.png`, PNG_1PX);
  await Bun.write(`${root}/.git/config`, "[core]\n");
});

beforeEach(async () => {
  await freshDb();
  sessionId = uniqueId("sess");
  const now = Date.now();
  await (await getDb())
    .insert(sessionsTable)
    .values({ id: sessionId, name: "browse-test", cwd: root, createdAt: now, updatedAt: now })
    .run();
});

afterEach(async () => {
  await (await getDb()).delete(sessionsTable).where(eq(sessionsTable.id, sessionId));
});

afterAll(async () => {
  await cleanupDbs();
  await removeTempDir(root);
});

describe("listBrowseEntries", () => {
  test("lists one level with folders first, metadata and `.git` skipped", async () => {
    const { entries, truncated } = await listBrowseEntries(root, "");
    const names = entries.map((e) => e.name);
    expect(truncated).toBe(false);
    expect(names.slice(0, 3)).toEqual(["docs", "images", "src"]);
    expect(names).not.toContain(".git");
    expect(names).toContain("README.md");

    const src = entries.find((e) => e.name === "src")!;
    expect(src.type).toBe("dir");
    expect(src.kind).toBe("dir");
    expect(src.size).toBeNull();
    expect(src.mtimeMs).toBeGreaterThan(0);

    const readme = entries.find((e) => e.name === "README.md")!;
    expect(readme.type).toBe("file");
    expect(readme.kind).toBe("markdown");
    expect(readme.language).toBe("markdown");
    expect(readme.size).toBe(README_SRC.length);
    expect(readme.path).toBe("README.md");

    const bin = entries.find((e) => e.name === "data.bin")!;
    expect(bin.kind).toBe("binary");
    expect(bin.language).toBeNull();
  });

  test("lists subdirectories and nested paths", async () => {
    const { entries } = await listBrowseEntries(root, "src");
    expect(entries.map((e) => e.name)).toEqual(["main.ts", "util.ts"]);
    expect(entries[0]!.path).toBe("src/main.ts");
    expect(entries[0]!.language).toBe("typescript");
  });

  test("returns image mime for images", async () => {
    const { entries } = await listBrowseEntries(root, "images");
    expect(entries[0]!.kind).toBe("image");
    expect(entries[0]!.mime).toBe("image/png");
  });

  test("missing dirs and escapes yield an empty listing", async () => {
    expect((await listBrowseEntries(root, "nope")).entries).toEqual([]);
    expect((await listBrowseEntries(root, "../")).entries).toEqual([]);
  });

  test("caps large directories and reports truncation", async () => {
    const { entries, truncated } = await listBrowseEntries(root, "", { limit: 2 });
    expect(entries.length).toBe(2);
    expect(truncated).toBe(true);
    expect(BROWSE_ENTRY_LIMIT).toBeGreaterThan(100);
  });
});

describe("readTextPreview", () => {
  test("returns text content and size", async () => {
    const p = await readTextPreview(`${root}/src/main.ts`);
    expect(p.status).toBe("text");
    expect(p.content).toBe("export const answer = 42;\n");
    expect(p.size).toBe(26);
  });

  test("flags binary content instead of decoding it", async () => {
    const p = await readTextPreview(`${root}/data.bin`);
    expect(p.status).toBe("binary");
    expect(p.content).toBeNull();
  });

  test("refuses files over the byte cap", async () => {
    const p = await readTextPreview(`${root}/big.txt`, 1000);
    expect(p.status).toBe("too-large");
    expect(p.content).toBeNull();
    expect(p.size).toBe(5000);
    expect((await readTextPreview(`${root}/big.txt`, 10_000)).status).toBe("text");
  });

  test("missing files reject with ENOENT", async () => {
    await expect(readTextPreview(`${root}/nope.txt`)).rejects.toThrow(/ENOENT/);
  });
});

describe("resolveWithinRoot", () => {
  test("rejects absolute paths and parent escapes", () => {
    expect(resolveWithinRoot("/tmp/proj", "src/a.ts")).toBe("/tmp/proj/src/a.ts");
    expect(resolveWithinRoot("/tmp/proj", "../a.ts")).toBeNull();
    expect(resolveWithinRoot("/tmp/proj", "src/../../a.ts")).toBeNull();
    expect(resolveWithinRoot("/tmp/proj", "/etc/passwd")).toBeNull();
  });
});

describe("GET …/files/browse", () => {
  test("returns entries for the session working directory", async () => {
    const res = await browseGET(get(`/api/sessions/${sessionId}/files/browse`), ctx(sessionId));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; data: { entries: Array<{ name: string }>; dir: string } };
    expect(body.ok).toBe(true);
    expect(body.data.dir).toBe("");
    expect(body.data.entries.map((e) => e.name)).toContain("README.md");
  });

  test("400s on escapes, 404s on unknown sessions", async () => {
    const esc = await browseGET(get(`/api/sessions/${sessionId}/files/browse?dir=../`), ctx(sessionId));
    expect(esc.status).toBe(400);
    const missing = await browseGET(get(`/api/sessions/does-not-exist/files/browse`), ctx("does-not-exist"));
    expect(missing.status).toBe(404);
  });
});

describe("GET …/files/content", () => {
  test("returns markdown source with language metadata", async () => {
    const res = await contentGET(
      get(`/api/sessions/${sessionId}/files/content?path=${encodeURIComponent("README.md")}`),
      ctx(sessionId),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { status: string; content: string; kind: string; language: string; size: number };
    };
    expect(body.data.status).toBe("text");
    expect(body.data.kind).toBe("markdown");
    expect(body.data.language).toBe("markdown");
    expect(body.data.content).toContain("# Hello");
  });

  test("reports binary files without content", async () => {
    const res = await contentGET(
      get(`/api/sessions/${sessionId}/files/content?path=data.bin`),
      ctx(sessionId),
    );
    const body = (await res.json()) as { data: { status: string; content: null } };
    expect(body.data.status).toBe("binary");
    expect(body.data.content).toBeNull();
  });

  test("404s for missing files and 400s for escapes", async () => {
    const missing = await contentGET(
      get(`/api/sessions/${sessionId}/files/content?path=nope.txt`),
      ctx(sessionId),
    );
    expect(missing.status).toBe(404);
    const esc = await contentGET(
      get(`/api/sessions/${sessionId}/files/content?path=${encodeURIComponent("../x")}`),
      ctx(sessionId),
    );
    expect(esc.status).toBe(400);
    const noPath = await contentGET(get(`/api/sessions/${sessionId}/files/content`), ctx(sessionId));
    expect(noPath.status).toBe(400);
  });
});

describe("GET …/files/raw", () => {
  test("streams images with their mime type and hardening headers", async () => {
    const res = await rawGET(
      get(`/api/sessions/${sessionId}/files/raw?path=${encodeURIComponent("images/pic.png")}`),
      ctx(sessionId),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-security-policy")).toContain("sandbox");
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(bytes.length).toBe(PNG_1PX.length);
    expect(bytes[0]).toBe(0x89);
  });

  test("serves text as text/plain (never html) and supports download", async () => {
    const inline = await rawGET(
      get(`/api/sessions/${sessionId}/files/raw?path=notes.txt`),
      ctx(sessionId),
    );
    expect(inline.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(inline.headers.get("content-disposition")).toContain("inline");

    const dl = await rawGET(
      get(`/api/sessions/${sessionId}/files/raw?path=data.bin&download=1`),
      ctx(sessionId),
    );
    expect(dl.headers.get("content-type")).toBe("application/octet-stream");
    expect(dl.headers.get("content-disposition")).toContain("attachment");
  });

  test("400s on escapes and 404s on missing files", async () => {
    expect(
      (await rawGET(get(`/api/sessions/${sessionId}/files/raw?path=${encodeURIComponent("../x")}`), ctx(sessionId)))
        .status,
    ).toBe(400);
    expect(
      (await rawGET(get(`/api/sessions/${sessionId}/files/raw?path=nope.png`), ctx(sessionId))).status,
    ).toBe(404);
  });
});
