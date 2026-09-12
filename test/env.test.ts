import { afterEach, describe, expect, test } from "bun:test";
import { defaultCwd, extraArgs, piBinary, rpcTimeoutMs } from "@/lib/pi/env";

const saved = { ...process.env };

afterEach(() => {
  for (const k of ["PI_BINARY", "PI_DEFAULT_CWD", "PIBOT_DEFAULT_CWD", "PI_EXTRA_ARGS", "PI_RPC_TIMEOUT_MS"]) {
    delete process.env[k];
  }
  Object.assign(process.env, saved);
});

describe("piBinary", () => {
  test("defaults to pi, trims override", () => {
    expect(piBinary()).toBe("pi");
    process.env.PI_BINARY = "  /opt/pi  ";
    expect(piBinary()).toBe("/opt/pi");
  });
});

describe("defaultCwd", () => {
  test("prefers PI_DEFAULT_CWD, falls back to process.cwd()", () => {
    delete process.env.PI_DEFAULT_CWD;
    delete process.env.PIBOT_DEFAULT_CWD;
    expect(defaultCwd()).toBe(process.cwd());
    process.env.PI_DEFAULT_CWD = "/tmp/proj";
    expect(defaultCwd()).toBe("/tmp/proj");
  });
});

describe("extraArgs", () => {
  test("empty by default, shell-like split with quotes", () => {
    expect(extraArgs()).toEqual([]);
    process.env.PI_EXTRA_ARGS = '--provider google --model "my model" -x';
    expect(extraArgs()).toEqual(["--provider", "google", "--model", "my model", "-x"]);
  });
});

describe("rpcTimeoutMs", () => {
  test("default and invalid values fall back to 120s", () => {
    expect(rpcTimeoutMs()).toBe(120_000);
    process.env.PI_RPC_TIMEOUT_MS = "5000";
    expect(rpcTimeoutMs()).toBe(5000);
    process.env.PI_RPC_TIMEOUT_MS = "garbage";
    expect(rpcTimeoutMs()).toBe(120_000);
    process.env.PI_RPC_TIMEOUT_MS = "0";
    expect(rpcTimeoutMs()).toBe(120_000);
  });
});
