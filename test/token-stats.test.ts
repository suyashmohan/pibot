/**
 * SSR render tests for the token breakdown popover.
 *
 * The header chip is CSS-gated to `lg` and the popover is hover/focus driven,
 * so the panel itself is the testable unit: given real pi stats it must spell
 * out input / cache hit / cache miss / output without needing a browser.
 */
import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { TokenBreakdownPanel } from "@/components/TokenStats";

const STATS = {
  input: 50_000,
  output: 10_000,
  cacheRead: 40_000,
  cacheWrite: 5_000,
  total: 105_000,
};

describe("TokenBreakdownPanel", () => {
  test("labels every row with formatted values and the cache hit rate", () => {
    const html = renderToString(createElement(TokenBreakdownPanel, { tokens: STATS, cost: 0.45 }));

    expect(html).toContain("Input");
    expect(html).toContain("95.0k"); // prompt volume: 50k + 40k + 5k
    expect(html).toContain("Cache hit");
    expect(html).toContain("40.0k");
    expect(html).toContain("42.1%"); // 40k / 95k
    expect(html).toContain("Cache miss");
    expect(html).toContain("55.0k"); // 50k + 5k
    expect(html).toContain("5.0k written to cache");
    expect(html).toContain("Output");
    expect(html).toContain("10.0k");
    expect(html).toContain("Total");
    expect(html).toContain("105.0k");
    expect(html).toContain("$0.45");
  });

  test("hides cache rows for sessions without cache activity", () => {
    const html = renderToString(
      createElement(TokenBreakdownPanel, { tokens: { input: 100, output: 20, total: 120 } }),
    );

    expect(html).not.toContain("Cache hit");
    expect(html).not.toContain("Cache miss");
    expect(html).toContain("Input");
    expect(html).toContain("Output");
  });

  test("renders a placeholder when stats are unavailable", () => {
    const html = renderToString(createElement(TokenBreakdownPanel, { tokens: null }));
    expect(html).toContain("No token usage yet");
  });
});
