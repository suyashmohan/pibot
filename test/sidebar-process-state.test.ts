/**
 * Sidebar pi-process indicators.
 *
 * The sidebar must answer two questions at a glance, per session:
 *   - is a pi process attached at all? (idle = attached but not working)
 *   - is the agent currently working in it?
 * Sessions with no process get no indicator.
 */
import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { Sidebar } from "@/components/Sidebar";
import type { ProjectListItem, SessionListItem } from "@/lib/client-api";
import { sessionProcessStates } from "@/lib/control/types";
import type { RunningProcessInfo } from "@/lib/control/types";

const now = Date.now();

function proc(over: Partial<RunningProcessInfo>): RunningProcessInfo {
  return {
    sessionId: "s",
    kind: "session",
    name: "n",
    cwd: "/tmp/proj",
    pid: 1,
    busy: false,
    startedAt: now,
    lastActivity: now,
    ...over,
  };
}

describe("sessionProcessStates", () => {
  test("maps live processes to per-session state, ignoring the server process", () => {
    const states = sessionProcessStates([
      proc({ sessionId: "a", busy: true }),
      proc({ sessionId: "b", busy: false }),
      proc({ sessionId: null, kind: "server" }),
    ]);
    expect(states).toEqual({ a: "working", b: "idle" });
  });

  test("no live processes → no state for anyone", () => {
    expect(sessionProcessStates([])).toEqual({});
  });
});

const PROJECT: ProjectListItem = {
  path: "/tmp/proj",
  name: "proj",
  pinned: true,
  missing: false,
  sessionCount: 3,
  updatedAt: now,
};

function session(id: string, name: string): SessionListItem {
  return {
    id,
    name,
    cwd: PROJECT.path,
    provider: null,
    modelId: null,
    thinkingLevel: null,
    piSessionId: null,
    piSessionFile: null,
    createdAt: now,
    updatedAt: now,
    preview: null,
    messageCount: 0,
  };
}

const SESSIONS = [session("a", "Work session"), session("b", "Idle session"), session("c", "No process")];

/** Slice the rendered HTML around a session name so per-row assertions work. */
function rowFor(html: string, name: string): string {
  const idx = html.indexOf(name);
  if (idx < 0) throw new Error(`session ${name} not rendered`);
  return html.slice(Math.max(0, idx - 260), idx + 120);
}

function renderSidebar(processStates: Record<string, "working" | "idle">): string {
  return renderToString(
    createElement(Sidebar, {
      sessions: SESSIONS,
      projects: [PROJECT],
      activeId: null,
      open: null,
      processStates,
      onClose: () => {},
      onSelect: () => {},
      onNew: () => {},
      onNewInProject: () => {},
      onDelete: () => {},
      onPinProject: async () => null,
      onUnpinProject: () => {},
    }),
  );
}

describe("Sidebar process indicators", () => {
  test("marks working agents and attached-but-idle processes on the right rows", () => {
    const html = renderSidebar({ a: "working", b: "idle" });

    expect((html.match(/aria-label="Agent working"/g) ?? []).length).toBe(1);
    expect((html.match(/aria-label="Pi process attached \(idle\)"/g) ?? []).length).toBe(1);

    expect(rowFor(html, "Work session")).toContain("Agent working");
    expect(rowFor(html, "Idle session")).toContain("Pi process attached");
    expect(rowFor(html, "No process")).not.toContain("Agent working");
    expect(rowFor(html, "No process")).not.toContain("Pi process attached");
  });

  test("renders no indicators when nothing is attached", () => {
    const html = renderSidebar({});
    expect(html).not.toContain("Agent working");
    expect(html).not.toContain("Pi process attached");
  });

  test("session rows still render without the prop (optional)", () => {
    const html = renderToString(
      createElement(Sidebar, {
        sessions: SESSIONS,
        projects: [PROJECT],
        activeId: null,
        open: null,
        onClose: () => {},
        onSelect: () => {},
        onNew: () => {},
        onNewInProject: () => {},
        onDelete: () => {},
        onPinProject: async () => null,
        onUnpinProject: () => {},
      }),
    );
    expect(html).toContain("Work session");
    expect(html).not.toContain("Agent working");
  });
});
