/**
 * Slash-command autocomplete helpers.
 *
 * Contract: the menu only appears while the *command name* itself is being
 * typed — a leading `/` at input position 0 with no whitespace after it.
 * Once the user accepts a command (`/name `) the menu is done; anything typed
 * after the space is a custom message that rides along with the command.
 */
import { describe, expect, test } from "bun:test";
import {
  filterSlashCommands,
  insertSlashCommand,
  slashQuery,
  type SlashCommand,
} from "@/lib/slash-commands";

const cmds: SlashCommand[] = [
  { name: "compact", description: "Compact the context", source: "extension" },
  { name: "model", description: "Switch the active model", source: "prompt" },
  { name: "review", description: "Review changes with compact output", source: "skill" },
];

describe("slashQuery", () => {
  test("null when the input is not in command position", () => {
    expect(slashQuery("")).toBeNull();
    expect(slashQuery("hello /compact")).toBeNull();
    expect(slashQuery(" /compact")).toBeNull();
    expect(slashQuery("//tail of a multiline\n/compact")).toBeNull();
  });

  test("empty query right after the slash", () => {
    expect(slashQuery("/")).toBe("");
  });

  test("partial command name", () => {
    expect(slashQuery("/comp")).toBe("comp");
    expect(slashQuery("/Compact")).toBe("Compact");
  });

  test("null once whitespace follows — the command is chosen, rest is a message", () => {
    expect(slashQuery("/compact ")).toBeNull();
    expect(slashQuery("/compact now please")).toBeNull();
    expect(slashQuery("/compact\nmore")).toBeNull();
  });
});

describe("filterSlashCommands", () => {
  test("empty query returns every command in order", () => {
    expect(filterSlashCommands(cmds, "")).toEqual(cmds);
  });

  test("case-insensitive match on name, description and source", () => {
    expect(filterSlashCommands(cmds, "MOD").map((c) => c.name)).toEqual(["model"]);
    expect(filterSlashCommands(cmds, "switch").map((c) => c.name)).toEqual(["model"]);
    expect(filterSlashCommands(cmds, "skill").map((c) => c.name)).toEqual(["review"]);
  });

  test("name matches rank above description matches", () => {
    // "comp" matches the name of `compact` and the description of `review`.
    expect(filterSlashCommands(cmds, "comp").map((c) => c.name)).toEqual(["compact", "review"]);
  });

  test("no matches yields an empty list", () => {
    expect(filterSlashCommands(cmds, "zzz")).toEqual([]);
  });
});

describe("insertSlashCommand", () => {
  test("inserts the command with a trailing space so a custom message can follow", () => {
    expect(insertSlashCommand("compact")).toBe("/compact ");
    expect(insertSlashCommand("review") + "focus on auth").toBe("/review focus on auth");
  });
});
