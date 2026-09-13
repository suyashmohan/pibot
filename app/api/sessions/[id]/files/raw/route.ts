import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { sessions as sessionsTable } from "@/lib/db/schema";
import { resolveWithinRoot } from "@/lib/files";
import { baseName } from "@/lib/utils";
import { fileKind, isTextKind, rawContentType } from "@/lib/file-browser";
import { fail, toErrorMessage } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** Header-safe file name for Content-Disposition. */
function dispositionName(name: string): string {
  return name.replace(/["\\\r\n]/g, "_") || "file";
}

/**
 * Raw bytes for one file: thumbnails, full image view and downloads.
 * `?path=` is relative to the session working directory; escapes are
 * rejected. Files are never served as `text/html` or a script type and the
 * response is sandboxed, so opening one in a tab cannot execute as
 * same-origin code. `?download=1` forces an attachment.
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
    const url = new URL(req.url);
    const rel = url.searchParams.get("path") ?? "";
    if (!rel.trim()) return fail("Missing path", 400);
    const abs = resolveWithinRoot(row.cwd, rel);
    if (!abs) return fail("Path is outside the session working directory", 400);

    const file = Bun.file(abs);
    let stat: Awaited<ReturnType<typeof file.stat>>;
    try {
      stat = await file.stat();
    } catch (err) {
      if ((err as { code?: string }).code === "ENOENT") return fail("File not found", 404);
      return fail(toErrorMessage(err), 500);
    }
    if (!stat.isFile()) return fail("Path is a directory, not a file", 400);

    const name = baseName(rel);
    const kind = fileKind(name, "file");
    const download =
      url.searchParams.get("download") === "1" || (!isTextKind(kind) && kind !== "image");
    return new Response(file, {
      status: 200,
      headers: {
        "Content-Type": rawContentType(name, kind),
        "Content-Length": String(stat.size),
        "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${dispositionName(name)}"`,
        "Cache-Control": "private, max-age=30",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
      },
    });
  } catch (err) {
    return fail(toErrorMessage(err), 500);
  }
}
