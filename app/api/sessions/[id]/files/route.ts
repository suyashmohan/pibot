import { control } from "@/lib/control";
import { mapControlError, ok } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * One directory level for the composer's `@` file picker.
 * `?dir=` is relative to the session working directory; escapes are rejected.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const dir = new URL(req.url).searchParams.get("dir") ?? "";
    return ok(await control.sessions.files.listMentions(id, dir));
  } catch (err) {
    return mapControlError(err);
  }
}
