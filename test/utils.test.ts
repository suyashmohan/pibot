import { describe, expect, test } from "bun:test";
import { baseName, cn, formatCost, formatTokens, timeAgo, tokenBreakdown, truncate, uid } from "@/lib/utils";

describe("cn", () => {
  test("merges and dedupes tailwind classes", () => {
    expect(cn("px-2", "px-4")).toBe("px-4");
    expect(cn("a", false && "b", "c")).toBe("a c");
  });
});

describe("timeAgo", () => {
  test("recent timestamps", () => {
    expect(timeAgo(Date.now())).toBe("just now");
    expect(timeAgo(Date.now() - 30_000)).toBe("just now");
  });
  test("minutes / hours / days", () => {
    expect(timeAgo(Date.now() - 5 * 60_000)).toBe("5m ago");
    expect(timeAgo(Date.now() - 2 * 3_600_000)).toBe("2h ago");
    expect(timeAgo(Date.now() - 3 * 86_400_000)).toBe("3d ago");
  });
});

describe("formatTokens", () => {
  test("scales", () => {
    expect(formatTokens(null)).toBe("—");
    expect(formatTokens(500)).toBe("500");
    expect(formatTokens(1500)).toBe("1.5k");
    expect(formatTokens(2_500_000)).toBe("2.5M");
  });
});

describe("formatCost", () => {
  test("formats", () => {
    expect(formatCost(null)).toBe("—");
    expect(formatCost(0)).toBe("$0.00");
    expect(formatCost(0.001)).toBe("$0.0010");
    expect(formatCost(1.5)).toBe("$1.50");
  });
});

describe("tokenBreakdown", () => {
  test("splits prompt volume into cache hit vs miss like pi's /usage", () => {
    const b = tokenBreakdown({
      input: 50_000,
      output: 10_000,
      cacheRead: 40_000,
      cacheWrite: 5_000,
      total: 105_000,
    });
    expect(b).not.toBeNull();
    expect(b!.input).toBe(95_000); // full prompt volume: fresh + cached + written
    expect(b!.cached).toBe(40_000);
    expect(b!.uncached).toBe(55_000); // fresh + cache write
    expect(b!.cacheWrite).toBe(5_000);
    expect(b!.output).toBe(10_000);
    expect(b!.total).toBe(105_000);
    expect(b!.hitRate).toBeCloseTo(40_000 / 95_000, 6);
  });

  test("no cache activity → no hit rate", () => {
    const b = tokenBreakdown({ input: 100, output: 20, cacheRead: 0, cacheWrite: 0, total: 120 });
    expect(b!.input).toBe(100);
    expect(b!.cached).toBe(0);
    expect(b!.uncached).toBe(100);
    expect(b!.hitRate).toBeNull();
  });

  test("writes without reads report a 0% hit rate (cache used, nothing served)", () => {
    const b = tokenBreakdown({ input: 0, output: 0, cacheRead: 0, cacheWrite: 2_000, total: 2_000 });
    expect(b!.hitRate).toBe(0);
    expect(b!.uncached).toBe(2_000);
  });

  test("missing fields default to 0 and total falls back to the sum", () => {
    const b = tokenBreakdown({ input: 10, output: 5 });
    expect(b!.total).toBe(15);
    expect(b!.cached).toBe(0);
    expect(b!.hitRate).toBeNull();
  });

  test("closed-form stub stats ({ total } only) do not crash", () => {
    const b = tokenBreakdown({ total: 10 });
    expect(b!.input).toBe(0);
    expect(b!.total).toBe(10);
  });

  test("absent stats → null", () => {
    expect(tokenBreakdown(null)).toBeNull();
    expect(tokenBreakdown(undefined)).toBeNull();
  });
});

describe("baseName", () => {
  test("returns the last path segment for display as a project name", () => {
    expect(baseName("/Users/me/code/alpha")).toBe("alpha");
    expect(baseName("/Users/me/code/alpha/")).toBe("alpha");
    expect(baseName("relative/path")).toBe("path");
    expect(baseName("/")).toBe("/");
  });
});

describe("truncate", () => {
  test("short strings untouched, long ones ellipsized", () => {
    expect(truncate("hi", 80)).toBe("hi");
    const out = truncate("a".repeat(100), 80);
    expect(out.length).toBeLessThanOrEqual(80);
    expect(out.endsWith("…")).toBe(true);
  });
});

describe("uid", () => {
  test("unique with prefix", () => {
    const a = uid("x-");
    const b = uid("x-");
    expect(a.startsWith("x-")).toBe(true);
    expect(a).not.toBe(b);
  });
});
