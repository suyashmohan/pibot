import { ensureClient, syncMessagesFromPi } from "@/lib/pi/manager";
import { fail, ok, readJson, toErrorMessage } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * Generic agent controls: abort, clear_queue, compact, set_auto_compaction,
 * set_auto_retry, abort_retry, set_steering_mode, set_follow_up_mode,
 * get_commands, get_fork_messages, get_last_assistant_text, export_html.
 */
export async function POST(req: Request, { params }: Params) {
  const { id } = await params;
  try {
    const body = await readJson<Record<string, unknown>>(req);
    const action = String(body.action ?? "");
    const client = await ensureClient(id);

    switch (action) {
      case "abort": {
        const res = await client.send({ type: "abort" }, { timeoutMs: 60_000 });
        if (!res.success) return fail(String(res.error ?? "abort failed"), 500);
        void syncMessagesFromPi(id).catch(() => {});
        return ok({ response: res });
      }
      case "clear_queue": {
        const res = await client.send({ type: "clear_queue" });
        if (!res.success) return fail(String(res.error ?? "clear_queue failed"), 500);
        return ok({ response: res });
      }
      case "compact": {
        const res = await client.send(
          {
            type: "compact",
            ...(typeof body.customInstructions === "string" && body.customInstructions.trim()
              ? { customInstructions: body.customInstructions.trim() }
              : {}),
          },
          { timeoutMs: 300_000 },
        );
        if (!res.success) return fail(String(res.error ?? "compact failed"), 500);
        void syncMessagesFromPi(id).catch(() => {});
        return ok({ response: res });
      }
      case "set_auto_compaction":
      case "set_auto_retry":
      case "set_steering_mode":
      case "set_follow_up_mode": {
        const res = await client.send({ type: action, ...body, action: undefined });
        if (!res.success) return fail(String(res.error ?? `${action} failed`), 500);
        return ok({ response: res });
      }
      case "abort_retry":
      case "get_commands":
      case "get_fork_messages":
      case "get_last_assistant_text": {
        const res = await client.send({ type: action });
        if (!res.success) return fail(String(res.error ?? `${action} failed`), 500);
        return ok({ response: res });
      }
      case "export_html": {
        const res = await client.send({
          type: "export_html",
          ...(typeof body.outputPath === "string" && body.outputPath ? { outputPath: body.outputPath } : {}),
        });
        if (!res.success) return fail(String(res.error ?? "export failed"), 500);
        return ok({ response: res });
      }
      default:
        return fail(`Unknown action: ${action || "(missing)"}`, 400);
    }
  } catch (err) {
    return fail(toErrorMessage(err), 500);
  }
}
