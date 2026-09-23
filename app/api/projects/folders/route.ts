import { control } from "@/lib/control";
import { mapControlError, ok } from "@/lib/api";

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
    return ok(await control.projects.listFolders(asked));
  } catch (err) {
    return mapControlError(err);
  }
}
