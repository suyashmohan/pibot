import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { sessions as sessionsTable } from "@/lib/db/schema";
import { readTextPreview, resolveWithinRoot } from "@/lib/files";
import { baseName } from "@/lib/utils";
import { fileKind, imageMimeFor, languageForFile } from "@/lib/file-browser";
import { fail, ok, toErrorMessage } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * Text preview for one file: UTF-8 content plus everything the UI needs to
 * render it (kind, syntax language, size). Binary and oversized files come
 * back with a status instead of content. `?path=` is relative to the session
 * working directory; escapes are rejected.
 */
export async function GET(req: Request, { params }: Params) {
  const { id } = await params;
  try {
    const row = (await getDb())
      .select()
      .from(sessionsTable)
      .where(eq(sessionsTable.id, id))
      .get();
    if (!row) return fail("Session not found", 404);
    const rel = new URL(req.url).searchParams.get("path") ?? "";
    if (!rel.trim()) return fail("Missing path", 400);
    const abs = resolveWithinRoot(row.cwd, rel);
    if (!abs) return fail("Path is outside the session working directory", 400);

    const name = baseName(rel);
    try {
      const preview = await readTextPreview(abs);
      return ok({
        path: rel,
        name,
        kind: fileKind(name, "file"),
        language: languageForFile(name),
        mime: imageMimeFor(name),
        status: preview.status,
        content: preview.content,
        size: preview.size,
        mtimeMs: preview.mtimeMs,
      });
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === "ENOENT") return fail("File not found", 404);
      if (code === "EISDIR") return fail("Path is a directory, not a file", 400);
      return fail(toErrorMessage(err), 500);
    }
  } catch (err) {
    return fail(toErrorMessage(err), 500);
  }
}
