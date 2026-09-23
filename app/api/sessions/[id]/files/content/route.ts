import { control } from "@/lib/control";
import { mapControlError, ok } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Text preview for one file: UTF-8 content plus everything the UI needs to
 * render it (kind, syntax language, size). Binary and oversized files come
 * back with a status instead of content. `?path=` is relative to the session
 * working directory; escapes are rejected.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const path = new URL(req.url).searchParams.get("path") ?? "";
    return ok(await control.sessions.files.preview(id, path));
  } catch (err) {
    return mapControlError(err);
  }
}
