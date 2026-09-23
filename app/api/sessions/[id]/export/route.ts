import { control } from "@/lib/control";
import { mapControlError } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Download the staged HTML export for one session. The file is produced by
 * `POST /control { action: "export_html" }` into the OS temp dir; this route
 * is a pure read (it never spawns pi) and always sends an attachment,
 * sandboxed and nosniff'd so a transcript can never execute as same-origin
 * code in a tab.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const file = await control.sessions.files.exportFile(id);
    return new Response(Bun.file(file.absPath), {
      status: 200,
      headers: {
        "Content-Type": file.contentType,
        "Content-Length": String(file.size),
        "Content-Disposition": `attachment; filename="${file.name}"`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
      },
    });
  } catch (err) {
    return mapControlError(err);
  }
}
