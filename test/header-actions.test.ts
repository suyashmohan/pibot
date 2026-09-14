/**
 * Chat-header action regressions (spotted in a screenshot review).
 *
 * 1. The header had *two* buttons wired to the same `showCmds` panel —
 *    `Braces` ("Available slash commands") and `GitFork` ("Session options
 *    (commands, fork, clone)"). Two icons, one panel: it made the action row
 *    read as toolbar soup and cost width the wrapped header needed. There must
 *    be exactly one entry point.
 *
 * 2. The sidebar toggle rendered a mobile hamburger in every viewport, which
 *    reads as a drawer button on a desktop where the sidebar is a static
 *    panel. The icon must be responsive: hamburger below `md`, panel toggle
 *    from `md` up.
 */
import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { AppShell } from "@/components/AppShell";
import { ChatView } from "@/components/ChatView";

function renderChat(): string {
  return renderToString(
    createElement(ChatView, {
      sessionId: "session-1",
      onRenamed: () => {},
      onSessionCloned: () => {},
    }),
  );
}

describe("chat header commands entry point", () => {
  test("commands + session options are reachable through exactly one button", () => {
    const html = renderChat();
    const titles = html.match(/title="[^"]*"/g) ?? [];
    const entryPoints = titles.filter((t) => /slash commands|session options/i.test(t));
    expect(entryPoints.length).toBe(1);
  });

  test("the remaining button still names both surfaces it opens", () => {
    const html = renderChat();
    const titles = html.match(/title="[^"]*"/g) ?? [];
    const entry = titles.find((t) => /slash commands|session options/i.test(t)) ?? "";
    expect(entry.toLowerCase()).toContain("command");
    expect(entry.toLowerCase()).toContain("session");
  });
});

describe("sidebar toggle icon", () => {
  test("is a drawer hamburger on mobile and a panel toggle on desktop", () => {
    const html = renderToString(createElement(AppShell));
    const toggle = /<button[^>]*title="Toggle sidebar"[\s\S]*?<\/button>/.exec(html)?.[0] ?? "";
    expect(toggle).not.toBe("");
    // Two icons, one per viewport — CSS-owned so SSR and hydration agree.
    expect(toggle).toContain("md:hidden");
    expect(toggle).toContain("hidden md:block");
  });
});
