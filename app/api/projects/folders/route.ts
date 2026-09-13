import path from "node:path";
import { defaultCwd } from "@/lib/pi/env";
import { listSubdirectories, resolveBrowseDir } from "@/lib/files";
import { fail, ok, toErrorMessage } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Folder browser for the sidebar's "Add project folder" input.
 * `?path=` is the user-typed path; partial/invalid paths resolve to their
 * parent so the picker can keep browsing. Only directories are returned.
 */
export async function GET(req: Request) {
  try {
    const asked = new URL(req.url).searchParams.get("path") ?? "";
    const fallback =
      process.env.HOME?.trim() || process.env.USERPROFILE?.trim() || defaultCwd();
    const dir = await resolveBrowseDir(asked, fallback);
    const parent = path.dirname(dir);
    const entries = await listSubdirectories(dir);
    return ok({ path: dir, parent: parent === dir ? null : parent, entries });
  } catch (err) {
    return fail(toErrorMessage(err), 500);
  }
}
