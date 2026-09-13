/**
 * Mobile chat-header regressions.
 *
 * Bun tests run without a paint engine, so these guard the *mechanism* of the
 * two mobile-header gaps reported after the desktop token-breakdown shipped:
 *
 * 1. The mobile overflow menu (the only way to reach header actions below
 *    `md`) rendered text-only rows, losing the iconography the desktop action
 *    row has. Every menu row must carry its icon.
 *
 * 2. Token / cost / context chips were `lg`-gated, so phones and tablets saw
 *    no usage stats at all. The mobile strip must exist below `lg` while the
 *    inline desktop row keeps rendering from `lg` up.
 */
import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { ChatView } from "@/components/ChatView";
import { MobileActionsMenu } from "@/components/MobileActionsMenu";
import { SessionStatChips } from "@/components/TokenStats";

const MENU_LABELS = [
  "Slash commands",
  "Bash console",
  "Compact context",
  "Copy last reply",
  "Export session (HTML)",
  "Clear queued messages",
];

describe("mobile overflow menu", () => {
  test("every row keeps its icon next to the label", () => {
    const html = renderToString(createElement(MobileActionsMenu, { onSelect: () => {} }));

    const buttons = html.match(/<button/g) ?? [];
    const icons = html.match(/<svg/g) ?? [];
    expect(buttons.length).toBe(MENU_LABELS.length);
    expect(icons.length).toBe(MENU_LABELS.length); // one icon per row, not text-only

    for (const label of MENU_LABELS) expect(html).toContain(label);
  });
});

describe("chat header stat chips", () => {
  const renderChat = () =>
    renderToString(
      createElement(ChatView, {
        sessionId: "session-1",
        onRenamed: () => {},
        onSessionCloned: () => {},
      }),
    );

  test("chips render on mobile (own strip) and on desktop (inline row)", () => {
    const html = renderChat();

    // Two live chips: the mobile strip and the lg-gated inline row.
    const chips = html.match(/aria-label="Token usage details"/g) ?? [];
    expect(chips.length).toBe(2);

    // Desktop row stays hidden below lg; the mobile strip is the mirror image.
    expect(html).toMatch(/class="[^"]*hidden[^"]*lg:flex[^"]*"/);
    const strip = /class="([^"]*lg:hidden[^"]*)"/.exec(html);
    expect(strip).not.toBeNull();
    expect(strip![1]).toContain("basis-full"); // wraps onto its own header line
  });

  test("strip shows token, cost and context once stats arrive", () => {
    const html = renderToString(
      createElement(SessionStatChips, {
        tokens: { input: 50_000, output: 10_000, cacheRead: 40_000, cacheWrite: 5_000, total: 105_000 },
        cost: 0.45,
        ctx: { percent: 42, tokens: 60_000, contextWindow: 200_000 },
      }),
    );

    expect(html).toContain("105.0k");
    expect(html).toContain("$0.45");
    expect(html).toMatch(/42(?:<!-- -->)?% ctx/);
  });

  test("context chip is omitted until usage is known", () => {
    const html = renderToString(
      createElement(SessionStatChips, { tokens: { total: 10 }, cost: 0, ctx: { percent: null } }),
    );
    expect(html).not.toContain("% ctx");
  });
});
