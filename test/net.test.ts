import { describe, expect, test } from "bun:test";
import { DEFAULT_BIND_HOST, DEFAULT_BIND_PORT, resolveBind } from "../lib/net";

describe("resolveBind", () => {
  test("defaults to loopback, never 0.0.0.0", () => {
    expect(resolveBind({})).toEqual({ host: DEFAULT_BIND_HOST, port: DEFAULT_BIND_PORT });
    expect(DEFAULT_BIND_HOST).toBe("127.0.0.1");
  });

  test("PIBOT_HOST opts into LAN binding", () => {
    expect(resolveBind({ PIBOT_HOST: " 0.0.0.0 " }).host).toBe("0.0.0.0");
  });

  test("PIBOT_PORT wins over PORT", () => {
    expect(resolveBind({ PIBOT_PORT: "4000", PORT: "5000" }).port).toBe(4000);
    expect(resolveBind({ PORT: "5000" }).port).toBe(5000);
  });

  test("blank values fall back to defaults", () => {
    expect(resolveBind({ PIBOT_HOST: "  ", PIBOT_PORT: "  ", PORT: "" })).toEqual({
      host: DEFAULT_BIND_HOST,
      port: DEFAULT_BIND_PORT,
    });
  });

  test("fails fast on an invalid port", () => {
    expect(() => resolveBind({ PIBOT_PORT: "abc" })).toThrow(/Invalid PIBOT_PORT/);
    expect(() => resolveBind({ PIBOT_PORT: "0" })).toThrow(/Invalid PIBOT_PORT/);
    expect(() => resolveBind({ PIBOT_PORT: "70000" })).toThrow(/Invalid PIBOT_PORT/);
    expect(() => resolveBind({ PIBOT_PORT: "3.5" })).toThrow(/Invalid PIBOT_PORT/);
  });
});
