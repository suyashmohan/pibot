import { describe, expect, test } from "bun:test";
import { Emitter } from "@/lib/emitter";

describe("Emitter", () => {
  test("on/emit delivers payloads in order", () => {
    const e = new Emitter();
    const seen: number[] = [];
    e.on<number>("n", (v) => seen.push(v));
    e.emit("n", 1);
    e.emit("n", 2);
    expect(seen).toEqual([1, 2]);
  });

  test("off and returned unsubscribe stop delivery", () => {
    const e = new Emitter();
    let a = 0;
    let b = 0;
    const fnA = () => a++;
    const unsub = e.on("x", () => b++);
    e.on("x", fnA);
    e.off("x", fnA);
    unsub();
    e.emit("x", 0);
    expect(a).toBe(0);
    expect(b).toBe(0);
  });

  test("removeAllListeners clears one or all events", () => {
    const e = new Emitter();
    let n = 0;
    e.on("a", () => n++);
    e.on("b", () => n++);
    e.removeAllListeners("a");
    e.emit("a", 0);
    e.emit("b", 0);
    expect(n).toBe(1);
    e.removeAllListeners();
    e.emit("b", 0);
    expect(n).toBe(1);
  });

  test("a throwing listener does not break others", () => {
    const e = new Emitter();
    let ok = false;
    e.on("boom", () => {
      throw new Error("bad listener");
    });
    e.on("boom", () => (ok = true));
    e.emit("boom", 0);
    expect(ok).toBe(true);
  });
});
