import { describe, expect, test } from "bun:test";
import { cn, formatCost, formatTokens, timeAgo, truncate, uid } from "@/lib/utils";

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
