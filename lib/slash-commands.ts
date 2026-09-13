/**
 * Slash-command autocomplete helpers (pure — unit-tested in
 * test/slash-commands.test.ts).
 *
 * The composer shows a command menu only while the command *name* is being
 * typed: a leading `/` at input position 0 with no whitespace after it.
 * Accepting a command inserts `/name ` (trailing space), so the user can
 * keep typing a custom message that is sent together with the command.
 */

export interface SlashCommand {
  name: string;
  description?: string;
  source: string;
}

/**
 * Text typed after a leading `/` while the command name is still open, or
 * `null` when the input is not in command position — including once the user
 * typed a space (command chosen, rest is a message).
 */
export function slashQuery(text: string): string | null {
  if (!text.startsWith("/")) return null;
  const token = text.slice(1);
  if (/\s/.test(token)) return null;
  return token;
}

/**
 * Case-insensitive match over name, description and source. Name matches sort
 * above description/source matches; original order is kept within a tier.
 */
export function filterSlashCommands(
  commands: readonly SlashCommand[],
  query: string,
): SlashCommand[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...commands];
  const rank = (c: SlashCommand): number => {
    const name = c.name.toLowerCase();
    if (name.startsWith(q)) return 0;
    if (name.includes(q)) return 1;
    return `${c.description ?? ""} ${c.source}`.toLowerCase().includes(q) ? 2 : -1;
  };
  return commands
    .map((command, order) => ({ command, rank: rank(command), order }))
    .filter((x) => x.rank >= 0)
    .sort((a, b) => a.rank - b.rank || a.order - b.order)
    .map((x) => x.command);
}

/** The text to put in the input when a command is picked. */
export function insertSlashCommand(name: string): string {
  return `/${name} `;
}
