import { describe, expect, test } from "bun:test";
import { assistantText, messagePreview, type AgentMessage } from "@/lib/pi/types";

describe("assistantText", () => {
  test("user string content", () => {
    expect(assistantText({ role: "user", content: "hi", timestamp: 1 })).toBe("hi");
  });
  test("user block content with image placeholder", () => {
    const m = {
      role: "user",
      content: [
        { type: "text", text: "look" },
        { type: "image", data: "x", mimeType: "image/png" },
      ],
      timestamp: 1,
    } as unknown as AgentMessage;
    expect(assistantText(m)).toBe("look[image]");
  });
  test("assistant text + thinking (thinking excluded)", () => {
    const m = {
      role: "assistant",
      content: [
        { type: "thinking", thinking: "hmm" },
        { type: "text", text: "answer" },
      ],
      timestamp: 1,
    } as unknown as AgentMessage;
    expect(assistantText(m)).toBe("answer");
  });
  test("toolResult joins text blocks", () => {
    const m = {
      role: "toolResult",
      toolCallId: "c1",
      toolName: "bash",
      content: [{ type: "text", text: "a" }, { type: "text", text: "b" }],
      timestamp: 1,
    } as unknown as AgentMessage;
    expect(assistantText(m)).toBe("a\nb");
  });
  test("bashExecution returns output", () => {
    expect(
      assistantText({
        role: "bashExecution",
        command: "ls",
        output: "x",
        exitCode: 0,
        cancelled: false,
        truncated: false,
        timestamp: 1,
      }),
    ).toBe("x");
  });
});

describe("messagePreview", () => {
  test("assistant with only tool calls summarizes them", () => {
    const m = {
      role: "assistant",
      content: [{ type: "toolCall", id: "c1", name: "bash", arguments: {} }],
      timestamp: 1,
    } as unknown as AgentMessage;
    expect(messagePreview(m)).toBe("Used bash");
  });
  test("long text is capped", () => {
    const m = {
      role: "assistant",
      content: [{ type: "text", text: "z".repeat(500) }],
      timestamp: 1,
    } as unknown as AgentMessage;
    expect(messagePreview(m).length).toBeLessThanOrEqual(120);
  });
});
