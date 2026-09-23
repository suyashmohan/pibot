import { control } from "@/lib/control";
import { mapControlError } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Raw bytes for one file: thumbnails, full image view and downloads.
 * `?path=` is relative to the session working directory; escapes are
 * rejected. Files are never served as `text/html` or a script type and the
 * response is sandboxed, so opening one in a tab cannot execute as
 * same-origin code. `?download=1` forces an attachment.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const url = new URL(req.url);
    const path = url.searchParams.get("path") ?? "";
    const file = await control.sessions.files.raw(id, path, {
      download: url.searchParams.get("download") === "1",
    });
    return new Response(Bun.file(file.absPath), {
      status: 200,
      headers: {
        "Content-Type": file.contentType,
        "Content-Length": String(file.size),
        "Content-Disposition": `${file.download ? "attachment" : "inline"}; filename="${file.name}"`,
        "Cache-Control": "private, max-age=30",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
      },
    });
  } catch (err) {
    return mapControlError(err);
  }
}
