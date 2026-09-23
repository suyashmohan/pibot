import { control } from "@/lib/control";
import { mapControlError, ok, readJson } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** List projects: pinned folders merged with folders discovered from sessions. */
export async function GET() {
  try {
    return ok(await control.projects.list());
  } catch (err) {
    return mapControlError(err);
  }
}

/** Pin (and validate) a project folder so it shows even with no sessions. */
export async function POST(req: Request) {
  try {
    const body = await readJson<{ path?: string }>(req);
    return ok(await control.projects.pin(body.path ?? ""), { status: 201 });
  } catch (err) {
    return mapControlError(err);
  }
}

/** Unpin a project folder (its sessions, if any, stay as a discovered group). */
export async function DELETE(req: Request) {
  try {
    const body = await readJson<{ path?: string }>(req);
    return ok(await control.projects.unpin(body.path ?? ""));
  } catch (err) {
    return mapControlError(err);
  }
}
