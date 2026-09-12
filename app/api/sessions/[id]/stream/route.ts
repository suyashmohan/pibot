import { ensureClient, subscribe } from "@/lib/pi/manager";
import type { PiEvent } from "@/lib/pi/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * SSE stream of pi RPC events for one web session.
 * Forwards agent events, tool progress, queue updates and
 * extension_ui_request dialogs to the browser.
 */
export async function GET(req: Request, { params }: Params) {
  const { id } = await params;

  // Make sure the pi process exists before streaming.
  try {
    await ensureClient(id);
  } catch (err) {
    return new Response(
      `event: error\ndata: ${JSON.stringify({ message: err instanceof Error ? err.message : String(err) })}\n\n`,
      {
        status: 500,
        headers: { "Content-Type": "text/event-stream" },
      },
    );
  }

  const stream = new ReadableStream({
    start(controller) {
      const enc = new TextEncoder();
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          /* closed */
        }
      };

      send("ready", { sessionId: id, ts: Date.now() });
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(enc.encode(`: ping ${Date.now()}\n\n`));
        } catch {
          /* closed */
        }
      }, 25_000);

      const off = subscribe(id, (ev: PiEvent) => {
        send(ev.type ?? "message", ev);
      });

      const abort = () => {
        clearInterval(heartbeat);
        off();
        try {
          controller.close();
        } catch {
          /* noop */
        }
      };
      req.signal.addEventListener("abort", abort, { once: true });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
