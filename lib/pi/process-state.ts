import type { RunningProcessInfo } from "./types";

/**
 * Per-session sidebar state:
 *   - `working` — a pi process is attached and the agent is mid-turn
 *   - `idle`    — a pi process is attached but nothing is running
 * Sessions with no attached process are absent from the map (no indicator).
 */
export type SessionProcessState = "working" | "idle";

/** Collapse the live process inventory into per-session sidebar state. */
export function sessionProcessStates(
  processes: RunningProcessInfo[],
): Record<string, SessionProcessState> {
  const out: Record<string, SessionProcessState> = {};
  for (const p of processes) {
    if (!p.sessionId) continue; // shared server metadata process
    out[p.sessionId] = p.busy ? "working" : "idle";
  }
  return out;
}
