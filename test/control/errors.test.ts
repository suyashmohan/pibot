import { describe, expect, test } from "bun:test";
import { ControlError, isControlError } from "@/lib/control/errors";

describe("ControlError", () => {
  test("carries an explicit status (never inferred from the code)", () => {
    const notFound500 = new ControlError("not_found", "Session not found", { status: 500 });
    const notFound404 = new ControlError("not_found", "Session not found", { status: 404 });

    expect(notFound500.code).toBe("not_found");
    expect(notFound500.status).toBe(500);
    expect(notFound404.status).toBe(404);
    expect(notFound500.message).toBe("Session not found");
  });

  test("supports 400/403/409/500 and extra payload", () => {
    const conflict = new ControlError("conflict", "busy", {
      status: 409,
      extra: { retry: true },
    });
    expect(conflict.status).toBe(409);
    expect(conflict.extra).toEqual({ retry: true });

    expect(new ControlError("forbidden", "nope", { status: 403 }).code).toBe("forbidden");
    expect(new ControlError("bad_request", "bad", { status: 400 }).code).toBe("bad_request");
  });

  test("sessionNotFound defaults to the ensure-path 500", () => {
    const err = ControlError.sessionNotFound();
    expect(err.status).toBe(500);
    expect(err.status).toBe(500);
    expect(err.code).toBe("not_found");
  });

  test("isControlError narrows", () => {
    expect(isControlError(new ControlError("internal", "x", { status: 500 }))).toBe(true);
    expect(isControlError(new Error("x"))).toBe(false);
    expect(isControlError("x")).toBe(false);
  });
});
