import { control } from "@/lib/control";
import { mapControlError, ok } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Working-tree git changes for the session folder: changed files with
 * added/removed line counts (no diff text). A folder that is not a git
 * repository comes back as `isRepo: false` (200), not an error. Pure read
 * path — never spawns pi.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    return ok(await control.sessions.files.gitStatus(id));
  } catch (err) {
    return mapControlError(err);
  }
}
