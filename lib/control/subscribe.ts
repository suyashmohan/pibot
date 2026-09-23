/**
 * Live session subscriptions.
 *
 * - `subscribeRaw` is the `@internal` raw PiEvent fan-out: no projector, no
 *   spawn. The HTTP SSE adapter is its only production caller.
 * - `subscribe` gives each listener its own `Projector` and emits snapshot
 *   `SessionEvent`s. Does not spawn.
 */

import { createProjector, pushPiEvent } from "./projector";
import type { AgentHost } from "@/lib/pi/host";
import type { PiEvent } from "@/lib/pi/types";
import type { SessionEvent, Unsubscribe } from "./types";

export function createSubscribeRaw(
  host: AgentHost,
): (id: string, listener: (ev: PiEvent) => void) => Unsubscribe {
  return (id, listener) => host.subscribeRaw(id, listener);
}

export function createSubscribe(
  host: AgentHost,
): (id: string, listener: (ev: SessionEvent) => void) => Unsubscribe {
  return (id, listener) => {
    // One projector per subscriber: idle reap / stop leave subscribers'
    // accumulation untouched.
    const projector = createProjector();
    return host.subscribeRaw(id, (ev) => {
      for (const sessionEvent of pushPiEvent(projector, ev)) listener(sessionEvent);
    });
  };
}
