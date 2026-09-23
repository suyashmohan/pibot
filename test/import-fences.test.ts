/**
 * Import fences as a grep test (PR 18 of the control-plane extraction).
 *
 * ESLint's core `no-restricted-imports` (eslint.config.mjs) enforces the same
 * rules for editor/CI lint; this test exists so a fence violation fails
 * `bun test` even if lint output is ignored, and so patterns ESLint cannot
 * express (globals like `Bun.spawn`, the server barrel string) are covered.
 */
import { describe, expect, test } from "bun:test";

const ROOT = process.cwd();

async function filesUnder(globs: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const glob of globs) {
    for await (const rel of new Bun.Glob(glob).scan({ cwd: ROOT, dot: false })) {
      out.push(rel);
    }
  }
  return out.sort();
}

async function violations(globs: string[], patterns: RegExp[]): Promise<string[]> {
  const bad: string[] = [];
  for (const rel of await filesUnder(globs)) {
    const text = await Bun.file(`${ROOT}/${rel}`).text();
    for (const rx of patterns) {
      if (rx.test(text)) bad.push(`${rel} matches ${rx}`);
    }
  }
  return bad;
}

describe("import fences", () => {
  test("app/api never reaches into the transport or spawns clients", async () => {
    const bad = await violations(
      ["app/api/**/*.ts"],
      [
        /\bensureClient\b/,
        /\bPiRpcClient\b/,
        /from\s+"@\/lib\/pi\/manager"/,
        /from\s+"@\/lib\/pi\/rpc-client"/,
        /from\s+"@\/lib\/pi\/host"/,
      ],
    );
    expect(bad).toEqual([]);
  });

  test("components/hooks do not import server or transport modules", async () => {
    const bad = await violations(
      ["components/**/*.{ts,tsx}", "hooks/**/*.{ts,tsx}", "app/page.tsx", "app/layout.tsx"],
      [
        /\bensureClient\b/,
        /\bPiRpcClient\b/,
        /\bBun\.spawn\b/,
        /from\s+"bun(:[a-z-]+)?"/,
        /from\s+"next\/server"/,
        /from\s+"@\/lib\/db"/,
        /from\s+"@\/lib\/control"/,
        /from\s+"@\/lib\/control\/health"/,
        /from\s+"@\/lib\/pi\/manager"/,
        /from\s+"@\/lib\/pi\/rpc-client"/,
        /from\s+"@\/lib\/pi\/host"/,
        /from\s+"@\/lib\/pi\/env"/,
      ],
    );
    expect(bad).toEqual([]);
  });

  test("hooks do not assemble Pi deltas themselves", async () => {
    const bad = await violations(
      ["hooks/**/*.{ts,tsx}"],
      [/\bEVENT_TYPES\b/, /text_delta/, /thinking_delta/, /toolcall_delta/],
    );
    expect(bad).toEqual([]);
  });

  test("chrome does not hard-code API URLs (rawFileUrl is the one exception)", async () => {
    const bad = await violations(
      ["components/**/*.{ts,tsx}", "hooks/**/*.{ts,tsx}"],
      [/"\/api\//, /'\/api\//],
    );
    expect(bad).toEqual([]);
  });

  test("lib/client is bundle-safe (no bun, db, manager, next/server)", async () => {
    const bad = await violations(
      ["lib/client/**/*.ts"],
      [
        /\bBun\.spawn\b/,
        /from\s+"bun(:[a-z-]+)?"/,
        /from\s+"@\/lib\/db"/,
        /from\s+"@\/lib\/pi\/manager"/,
        /from\s+"@\/lib\/pi\/rpc-client"/,
        /from\s+"@\/lib\/control\/health"/,
        /from\s+"next\/server"/,
      ],
    );
    expect(bad).toEqual([]);
  });

  test("control types/projector stay isomorphic", async () => {
    const bad = await violations(
      ["lib/control/types.ts", "lib/control/projector.ts"],
      [
        /\bBun\.spawn\b/,
        /from\s+"bun(:[a-z-]+)?"/,
        /from\s+"next(\/[a-z-]+)?"/,
        /from\s+"react(-dom)?"/,
        /from\s+"@\/lib\/pi\/manager"/,
      ],
    );
    expect(bad).toEqual([]);
  });

  test("lib/pi/types.ts is transport-only (no domain re-exports)", async () => {
    const bad = await violations(
      ["lib/pi/types.ts"],
      [
        /\bAgentMessage\b/,
        /\bSessionEvent\b/,
        /\bSTREAMING_MESSAGE_ID\b/,
        /\bstreamingAssistantMessage\b/,
        /\bmessagePreview\b/,
        /from\s+"\.\.\/control\//,
      ],
    );
    expect(bad).toEqual([]);
  });
});
