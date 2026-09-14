# PiBot Bots — feature plan (rev 2, decisions locked)

> Status: **plan / not implemented**. This is the single reference for the
> "two workloads" change: project sessions (today) **plus** durable persona
> agents ("Bots"), modeled on xAI's Grok Bot.
>
> Rev 2 locks the product decisions from review and adds a **Phase 0:
> harden the shared session core** that is recommended before any Bot code.

---

## 1. Goal

PiBot today has exactly one workload: **project work** — a session is a folder
plus a `pi --mode rpc` process. Great for engineering, awkward for everyone
else ("why do I need a working directory to write an Instagram caption?").

We add a second workload: **Bots**.

A Bot is a durable AI teammate with a name, a job, its own workspace, and its
own conversation. You chat with it like a subordinate, a friend, or an
employee. It keeps its role across sessions because the role is **config**,
not a per-chat prompt.

| | Projects (existing) | Bots (new) |
|---|---|---|
| Mental model | "work in this repo" | "talk to this role" |
| Identity | session name | name + title + emoji + persona |
| Setup cost | pick folder, provider, model | pick a template, done |
| System prompt | pi default (+ repo `AGENTS.md`) | bot persona (replaces default) |
| Scope | whole project folder | managed private workspace |
| Tools | all pi built-ins | scoped presets (files-only default) |
| Extras | — | skills, new/compact conversations |
| Grouping | sidebar by folder | sidebar by bot (pin / hide) |

Everything lives behind the existing lazy-spawn contract: creating or opening
a Bot never boots `pi`; the first prompt does.

---

## 2. Grok Bot parity target

Researched from xAI's own docs (`docs.x.ai/grok-bot/*`):

- A Bot is *"a durable AI teammate with a name, a job, its own conversation,
  and working context that develops over time."*
- Create via **New → Create new agent**; edit name, title, description,
  avatar under **Edit Profile**.
- **Description** holds rules that stay true; **messages** hold task
  instructions.
- **Skills** = reusable instruction sets, available across bots.
- **Routines** = scheduled/event-triggered workflows owned by one bot.
- Bots share one computer (files/logins); they can DM and group-chat.
- Memory persists stable preferences/facts, but is explicitly *not* an
  authoritative source.
- Pin / hide / duplicate / delete; duplicate copies config, **not** history.
- Approvals gate consequential actions.

### Scope ladder

| Grok Bot concept | PiBot v1 (this plan) | PiBot later |
|---|---|---|
| Identity (name/title/avatar) | ✅ `bots` table (emoji avatar) | image avatars |
| Own conversation | ✅ one **active** conversation + New / Compact | multiple live threads |
| Description (durable rules) | ✅ persona prompt | — |
| Skills | ✅ skill library + per-bot attach | skill packs / sharing |
| Connectors / tools | ✅ tool presets (files default) + extension attach | bundled pibot extensions, approvals |
| Own computer | ✅ managed workspace + existing Files panel | login/credential handoff |
| Working memory | ❌ deferred (see §14) | notes field + `remember` tool |
| Routines | ❌ deferred (see §15) | scheduler + run log |
| Pin / hide / duplicate / delete | ✅ | — |
| Team / group chat | ❌ deferred (see §16) | multi-bot conversation |
| Share link | ❌ | export/import bot JSON |

---

## 3. Locked decisions

These were confirmed in review on rev 2. Treat them as requirements; changes
need explicit sign-off.

### L1 — Label is **Bots**

UI copy says "Bot" everywhere. Code uses `bot`. The sidebar workload toggle
reads **Projects** | **Bots**. Keep the label in one constant so a rename is
one line.

### L2 — One active conversation per bot, with New conversation and Compact

- A bot always has exactly **one active conversation**. The sidebar shows one
  row per bot, not one row per conversation.
- **New conversation**: archives the active conversation and starts a fresh
  one against the same bot config and workspace. The archived conversation
  stays in the database and is listed under the bot's profile
  (**Conversations**: title, date, open, delete).
- **Compact**: already implemented end-to-end in PiBot
  (`/api/sessions/[id]/control` → `compact`, wired in `ChatView`) — bots reuse
  it unchanged.
- Opening an archived conversation makes it active again (the previously
  active one is archived). Each conversation has its **own pi session file**,
  so no history is mixed.

This needs a `bot_threads` table (new table, no ALTER — see §6).

Rejected alternative: pi's RPC `new_session` command on the same web session
row. It creates a fresh pi session file, but the old conversation would have
no row in PiBot and thus no UI home; switching back would be lossy.

### L3 — Managed workspace only in v1

Bots get `data/bots/<botId>/workspace/`, created on demand. The user never
picks a folder and never sees a path unless they open the Files panel.
Pointing a bot at an existing folder is a **future** advanced option, not v1.

### L4 — Tool access: files preset

Default and only exposed preset in v1 is `files`:
`--tools read,ls,grep,find,write,edit` (`bash` off). A "Full access (adds
shell)" option may exist behind Advanced, but the default and the copy must
not push it. Rationale: `bash` is an unrestricted shell as the PiBot user;
bots are the non-technical workload.

Note: pi only surfaces attached skills when `read` **or** `bash` is enabled
(`dist/core/system-prompt.js` `skillFileReadTool`). `files` includes `read`,
so skills work.

### L5 — Routines stay out of v1

No scheduler, no `bot_routines` table in v1. The design is preserved in §15
so it can be picked up without rethinking.

### L6 — No memory subsystem in v1

With one long-lived conversation, history *is* memory: pi persists the JSONL
session file and auto-compacts when the context window fills. Durable rules
belong in the bot's persona/description, which always applies — including to
new conversations. Full reasoning and the design for when we do need it are
in §14.

### L7 — Bots are sessions under the hood

A bot conversation is a normal `sessions` row plus a pi process: SSE fan-out,
lazy spawn, message cache, stats, model picker, file browser, and
`usePiSession` all keep working untouched. Zero new chat machinery.

### L8 — Persona replaces pi's base prompt via `--system-prompt <file>`

Verified in pi `dist/core/system-prompt.js`: with `customPrompt`, pi builds
`customPrompt` + append-section + project context + skills + cwd. It does not
inject the "expert coding assistant" voice or tool snippets. Tool
*definitions* are still sent to the model (function calling is independent of
the prompt), so no capability is lost.

`--system-prompt` also accepts a path to an existing file — pi's
`resolvePromptInput()` does `existsSync(input) ? readFileSync(input) : input`
(`dist/core/resource-loader.js:17`). **Always pass a path**, never inline
text: on Linux `MAX_ARG_STRLEN` is 128 KB per argument and brand guides will
exceed that.

### L9 — Bots spawn with `--no-context-files` and `--no-approve`

**The single most important correctness detail.** pi loads context files from
`~/.pi/agent/AGENTS.md`, from the cwd, and from **every ancestor directory up
to the filesystem root** (verified in `resource-loader.js`: the
`while (true) { … parentDir = dirname(currentDir) }` walk, plus the global
context file each run — see `docs/usage.md` § Context Files). Bot workspaces
live under `data/bots/…` inside the PiBot repo, so without
`--no-context-files` every bot would get the user's **global** AGENTS.md *and*
PiBot's own 10 KB `AGENTS.md` (Next.js build rules, drizzle gotchas…)
injected into its personality. That is delightful for a coding session and
absurd for a marketing bot.

`--no-approve` ("Ignore project-local files for this run") additionally keeps
`.pi/settings.json`, project extensions, `SYSTEM.md`, and project
`.agents/skills` out of bot runs — important because a bot with `write` access
can create those files itself and would otherwise self-execute code on the
next spawn.

Project sessions keep today's behavior exactly.

### L10 — Profile edits respawn lazily, never mid-turn

pi has no runtime `set_system_prompt` RPC (verified against `docs/rpc.md`);
the system prompt is spawn-time only. So changing persona/skills/tools/model:

- idle conversation → dispose and respawn immediately (`respawnClient`, keeps
  the managed entry and its SSE subscribers, same contract as `stopProcess`);
- busy conversation → flag `restartPending` and respawn on `agent_settled`,
  so an in-flight turn is never killed;
- the UI toasts "Bot updated — restarted" on the `client_exit` event.

### L11 — Bots are invisible to the project workload

`/api/projects` and the work sidebar must never show bot workspaces as
projects. `/api/sessions` gains `?kind=work` (default, excludes bot threads);
the Bots tab is fed by `/api/bots`, which computes its own previews.

---

## 4. Where this meets pi (verified primitives)

Everything the plan needs already exists in the installed pi:

| Need | pi primitive | Evidence |
|---|---|---|
| Persona replaces base prompt | `--system-prompt <text-or-file>` | `pi --help`; `resolvePromptInput` (`dist/core/resource-loader.js:17`) |
| Extra always-on text (future memory) | `--append-system-prompt <file>` (repeatable) | `pi --help`; args parser pushes to an array |
| Skills | `--skill <path>` (repeatable), `--no-skills` | `pi --help`; `docs/skills.md` |
| Tool allow/deny | `--tools a,b,c`, `--exclude-tools`, `--no-tools` | `pi --help` |
| Extensions | `--extension <path>` (repeatable), `--no-extensions` | `pi --help` |
| No inherited project context | `--no-context-files` | `docs/usage.md` § Context Files |
| No project-local resources | `--no-approve` | `pi --help` |
| Session per conversation | `--session <file>` / `--name <name>` | already used by `rpc-client.ts` |
| Compact | RPC `compact` | `docs/rpc.md`; already in PiBot's control route |
| Enumerate skills/commands | RPC `get_commands` | `docs/rpc.md`; already in `usePiSession` |
| Interactive dialogs (future approvals) | `extension_ui_request` | `docs/rpc.md`; already handled by `/extension-ui` |

---

## 5. Phase 0 — harden the shared session core (recommended first)

**Recommendation: do this before Bots, but keep it bounded.** Do not gold-plate
the Projects feature; fix the *shared* foundations that Bots multiply.

### Why first

A Bot is a `sessions` row with config (L7). Every Session/manager/SSE
weakness becomes a Bot weakness, and Bots add pressure to exactly those
paths: more concurrent syncs, more processes, and much bigger payloads (a
content bot reads and writes whole documents, not short code snippets). The
items below are verified findings from an audit of the current code, not
speculation.

### Phase 0 checklist (each item starts with a failing test)

1. **Serialize / atomize the message cache.** `persistMessages` is
   delete-all + insert-all with no transaction and no per-session
   serialization, while `syncMessagesFromPi` is called concurrently from at
   least five places: `manager.ts` settle handler, `GET /api/sessions/[id]`,
   `GET /messages`, `POST /control`, and `lifecycle`. Interleaved runs can
   duplicate rows or drop cached messages.
   Fix: per-session in-flight promise (same memoization pattern as
   `ensureClient`) and/or wrap the delete+insert in one sqlite transaction.
   Test: fire N concurrent `persistMessages` calls, assert exact row count and
   no duplicates.

2. **Stop corrupting large messages.** `persistMessages` truncates
   `rawJson` with `JSON.stringify(m).slice(0, 500_000)` and `contentJson` with
   `.slice(0, 200_000)`. A slice through JSON is *invalid JSON*;
   `readCachedMessages` silently `JSON.parse`-fails and skips the row, so big
   turns (a long file read, a whole document) vanish from the transcript after
   reload. Bots hit this constantly.
   Fix: truncate long *string fields* before `stringify` (or store a
   well-formed envelope with a `truncated: true` marker and an excerpt).
   Test: a 1 MB tool result round-trips as valid JSON and stays visible.

3. **Kill the N+1 in `GET /api/sessions`.** One message query per session per
   sidebar refresh. Fix while extracting `lib/session-preview.ts`: load all
   cached messages in one query and group in memory.
   Test: pure grouping helper (`test/session-preview.test.ts`).

4. **Close route-level test gaps.** Add regression tests for
   `DELETE /api/sessions/[id]` while the agent is mid-stream (must not throw,
   must remove rows and reap the process), session `PATCH`, and the
   `lifecycle` actions. Route handlers are already testable directly (see
   `test/lazy-spawn.test.ts`), so this is cheap.

5. **Surface a missing working directory.** A deleted project folder only
   fails later as a spawn toast. Show a "folder missing" state on the session
   row (projects already compute `missing`) and keep the error actionable.

### Explicitly out of scope for Phase 0 (Projects-only polish, can wait)

Project aliases/rename, session pinning, bulk archive/delete, message search,
import/export/backup, richer empty states. None of these block Bots; doing
them first would delay the new workload without reducing its risk.

### Suggested sequence

`Phase 0 (1–3, mostly tests) → Phase 0 (4–5) → Bot Phase 1 → …`

---

## 6. Data model

New tables only, added to both `lib/db/schema.ts` and the idempotent fallback
DDL in `lib/db/index.ts`.

**Why new tables only (verified constraint):** there is no `drizzle/`
migration directory in the repo, so `lib/db/index.ts` runs its fallback
`CREATE TABLE IF NOT EXISTS` block. (If any `*.sql` exists, `migrate()` runs
instead — and drizzle-generated migrations emit plain `CREATE TABLE`, which
would fail on existing databases.) New tables with `IF NOT EXISTS` work on
both fresh and existing DBs; adding a column to `sessions` would not. That is
why the thread FK lives on `bot_threads`, not on `sessions`.

```ts
export const bots = sqliteTable("bots", {
  id: text("id").primaryKey(),                   // nanoid(12)
  name: text("name").notNull(),                  // "Aria"
  title: text("title").notNull().default(""),    // "Marketing Content Bot"
  avatar: text("avatar").notNull().default("🤖"), // emoji
  /** Short "what this bot is for" — shown in lists, used in the prompt header. */
  description: text("description").notNull().default(""),
  /** Durable rules + persona. Rendered verbatim into system-prompt.md. */
  systemPrompt: text("system_prompt").notNull().default(""),
  /** cwd for pi processes; always data/bots/<id>/workspace in v1. */
  workspaceDir: text("workspace_dir").notNull(),

  /** Template this bot was created from (analytics / "reset to template"). */
  templateId: text("template_id"),

  provider: text("provider"),
  modelId: text("model_id"),
  thinkingLevel: text("thinking_level"),

  /** v1: always "files". Kept as a column so shell access is config, not code. */
  toolPreset: text("tool_preset").notNull().default("files"),
  /** Explicit allowlist for preset = "custom" (JSON string[]). */
  toolsJson: text("tools_json").notNull().default("[]"),
  /** Always-on denylist (JSON string[]). */
  excludeToolsJson: text("exclude_tools_json").notNull().default("[]"),
  /** Absolute extension paths (JSON string[]); used when restrictExtensions. */
  extensionsJson: text("extensions_json").notNull().default("[]"),
  restrictExtensions: integer("restrict_extensions", { mode: "boolean" })
    .notNull().default(false),
  useGlobalSkills: integer("use_global_skills", { mode: "boolean" })
    .notNull().default(false),

  pinned: integer("pinned", { mode: "boolean" }).notNull().default(false),
  hidden: integer("hidden", { mode: "boolean" }).notNull().default(false),

  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

/**
 * One row per bot conversation. Exactly one row per bot has archivedAt = null
 * (the active conversation); enforced in app code and tested.
 */
export const botThreads = sqliteTable(
  "bot_threads",
  {
    id: text("id").primaryKey(),
    botId: text("bot_id").notNull().references(() => bots.id, { onDelete: "cascade" }),
    sessionId: text("session_id").notNull(),  // -> sessions.id
    /** Display title; derived from the first user message, editable later. */
    title: text("title").notNull().default(""),
    /** null = active conversation. */
    archivedAt: integer("archived_at"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [
    index("bot_threads_bot_idx").on(t.botId),
    uniqueIndex("bot_threads_session_uidx").on(t.sessionId),
  ],
);

/** Reusable skill library (global; attach to many bots). */
export const skills = sqliteTable("skills", {
  id: text("id").primaryKey(),
  slug: text("slug").notNull(),               // ^[a-z0-9]+(-[a-z0-9]+)*$
  name: text("name").notNull(),
  description: text("description").notNull(), // Agent Skills spec: <=1024 chars
  body: text("body").notNull().default(""),   // SKILL.md body (below frontmatter)
  builtin: integer("builtin", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const botSkills = sqliteTable(
  "bot_skills",
  {
    botId: text("bot_id").notNull().references(() => bots.id, { onDelete: "cascade" }),
    skillId: text("skill_id").notNull().references(() => skills.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.botId, t.skillId] })],
);
```

Notes:

- `foreign_keys = ON` is already set in `createDb()`.
- `messages.sessionId → sessions.id ON DELETE CASCADE` already exists, so
  deleting a conversation's session row removes its cache.
- Concurrency invariant (L2): every mutation that creates/archives threads
  runs in one drizzle transaction so "exactly one active thread" holds even
  under double-clicks.
- Bot deletion: delete `bots` row → `bot_threads` + `bot_skills` cascade;
  then delete the thread `sessions` rows (and `destroyClient` first). Managed
  workspace is removed too (it lives in app data; the delete confirm names the
  folder, and the Files panel is the escape hatch for keeping files).

---

## 7. Runtime: prompt composition, materialization, spawn contract

### 7.1 Compose the persona (`lib/bots/prompt.ts`, pure, unit-tested)

`composeBotSystemPrompt(bot, opts)` produces the markdown written to
`runtime/system-prompt.md`. It wraps the user's persona with PiBot framing so
bots behave consistently without the user writing plumbing:

```md
You are **Aria**, the Marketing Content Bot.

<bot.description>

# Your role and rules
<bot.systemPrompt>

# How you work
- You are a persistent teammate, not a one-shot assistant. Your human returns
  to this same conversation; keep context and follow through.
- Work inside your workspace: `…/workspace`. Put deliverables in files there
  (use `read`/`write`/`edit`), and name them clearly so they can be found later.
- Prefer skills (below) when a task matches one; load the skill before acting.
- If a request is ambiguous, ask one focused question instead of guessing.
- Never invent file contents, sources, or results. Say when something is missing.
- Keep answers concise; show file paths for artifacts.

# Environment
- Date: {ISO date}
- Workspace: {workspace}
- Tools: {read, ls, grep, find, write, edit}
```

pi then appends the skills XML (from `--skill`) and
`Current working directory: …`. Persona variables: `{{name}}`, `{{title}}`,
`{{description}}`, `{{workspace}}`, `{{date}}`, `{{userName}}` (from
`settings`, optional). Unknown variables stay literal — no silent data loss.

### 7.2 Build the spawn flags (`lib/bots/spec.ts`, pure, unit-tested)

```ts
export interface BotSpawnOptions {
  systemPromptFile?: string;          // --system-prompt <file>
  appendSystemPromptFiles: string[];  // --append-system-prompt <file> (future notes)
  skills: string[];                   // --skill <dir>
  disableSkills: boolean;             // --no-skills
  extensions: string[];               // --extension <file>
  disableExtensions: boolean;         // --no-extensions
  tools?: string[];                   // --tools a,b
  excludeTools?: string[];
  noContextFiles: boolean;            // --no-context-files (bots: always true)
  noApprove: boolean;                 // --no-approve       (bots: always true)
  env: Record<string, string>;        // PIBOT_BOT_ID, PIBOT_BOT_WORKSPACE, …
}
```

`buildBotSpawnFlags(bot, skills, paths)` is a pure function of rows + resolved
paths. `PiRpcClient.spawn` gains matching `SpawnOptions` fields and appends
them in a **fixed order** after `extraArgs()` so bot config wins over
`PI_EXTRA_ARGS` (same precedence provider/model already have). `spawnArgs` is
public, so tests assert exact arrays.

### 7.3 Materialize (`lib/bots/materialize.ts`, temp-dir tested)

```
data/bots/<botId>/
├── bot.json               # debug/export snapshot (written, never read back)
├── workspace/             # the bot's cwd; deliverables live here
└── runtime/               # regenerated on every spawn
    ├── system-prompt.md
    └── skills/<slug>/SKILL.md
```

`materializeBotRuntime(bot, skills) → BotRuntimePaths`:

- `Bun.write()` for every file (it creates parent directories — verified);
  `Bun.Glob`/`Bun.$` for dir probing; `node:path` for path math only (house
  rule: no other `node:` imports).
- Creates `workspace/` if missing so `dirExists(row.cwd)` in the manager
  passes on first spawn.
- Prunes skill dirs left from a previous materialization.
- Idempotent and cheap; runs on every (re)spawn.
- Skill frontmatter is generated by PiBot:
  `---\nname: <slug>\ndescription: <description>\n---\n\n<body>`.

Child env (for future features): `PIBOT_BOT_ID`, `PIBOT_BOT_NAME`,
`PIBOT_BOT_WORKSPACE`. Merged over the explicit `{ ...process.env }` snapshot
that `rpc-client.ts` already does (Bun.spawn does not inherit post-start env
mutations).

---

## 8. Manager changes (`lib/pi/manager.ts`)

1. `ensureClientInner`: after loading the session row, look up `bot_threads`
   by `sessionId`. If found, load the bot, materialize the runtime, and merge
   bot spawn options. Resolution happens **at spawn time**, so L10 works for
   free.
2. `respawnClient(webId, reason)`: like `stopProcess` — detach, dispose, keep
   entry + emitter, emit `client_exit { reason }`. Used by bot PATCH.
3. Deferred restart: add `restartPending?: boolean` to `ManagedEntry`; on
   `agent_settled`/`compaction_end` in the forwarding handler, respawn when
   set.
4. `listRunningProcesses`: add `kind: "bot"` + `botId`/`botName` so the
   process panel reads "Aria (Marketing)".
5. `enforceProcessCap` / `sweepIdleClients` stay as-is. Bots are ordinary
   entries: idle bots get reaped and respawn on the next message.

Test infrastructure (`test/helpers/fake-pi.ts`):

- `FAKE_PI_ARGV_FILE=/tmp/…` → the stub writes `process.argv` at startup;
  tests assert exact spawn flags.
- `FAKE_PI_REPORT_SYSTEM_PROMPT=1` → the stub reads the `--system-prompt`
  file (if any) and returns its contents in `get_state`, proving persona text
  reaches the child end-to-end, not just that a flag was built.

---

## 9. API surface

All routes: `runtime = "nodejs"`, `dynamic = "force-dynamic"`, `{ ok, data }`
envelope via `lib/api.ts`, `readJson` for bodies (never trust Content-Type).

| Route | Purpose |
|---|---|
| `GET /api/bots` | list: config + active conversation preview + process state; `?hidden=1` includes hidden |
| `POST /api/bots` | create from `{ templateId?, name, title, avatar?, description?, systemPrompt?, provider?, model?, skillIds? }`; creates bot + first thread session row in one transaction, **no spawn** |
| `GET /api/bots/[id]` | config + skills + resolved capabilities + conversations |
| `PATCH /api/bots/[id]` | update config; respawns live conversations per L10 |
| `POST /api/bots/[id]/duplicate` | copy config + skills + tools; new workspace; new empty conversation (Grok parity: no history) |
| `DELETE /api/bots/[id]` | destroy clients, delete bot + threads + session rows + managed workspace |
| `POST /api/bots/[id]/restart` | explicit respawn ("restart to apply") |
| `GET /api/bots/templates` | starter templates (`lib/bots/templates.ts`) |
| `GET/POST /api/bots/[id]/threads` | list conversations / **new conversation** (archive active, create session row, transaction) |
| `PATCH/DELETE /api/bots/[id]/threads/[threadId]` | make active (archive the other) / delete conversation |
| `GET/POST /api/skills`, `PATCH/DELETE /api/skills/[id]` | global skill library |
| `GET/PUT /api/bots/[id]/skills` | attach/detach |
| `GET /api/bots/[id]/extensions` | discovered extension paths to pick from |
| `GET /api/sessions?kind=work` | exclude bot conversations from the work sidebar |
| `GET /api/sessions/[id]` | unchanged shape; add `bot: { id, name, title, avatar } \| null` so the chat header needs no second fetch |

`/api/projects` filters out sessions referenced by `bot_threads`.

Extract the inline preview computation from `app/api/sessions/route.ts` into
`lib/session-preview.ts` (pure) so both endpoints use it and it gets unit
tests — this is also Phase 0 item 3.

---

## 10. UI / UX

### Sidebar: two workloads, one toggle

`components/Sidebar.tsx` gains a segmented control:

```
[ Projects ] [ Bots ]
```

- **Projects** — today's tree, plus `?kind=work`.
- **Bots** — pinned first, then the rest. Row: emoji avatar, name, title or
  active-conversation preview, process dot (reuses `SessionProcessState`),
  hover actions (pin, hide, menu). Footer: **+ New bot**, "Show hidden".
- Persistence follows the hydration rule: mode starts `"work"` on server and
  first client render; the saved pref hydrates in `useEffect`
  (`lib/layout.ts` gets `loadSidebarMode`/`saveSidebarMode`, same pattern as
  `loadCollapsedPaths`). Covered by `test/hydration.test.ts`.

### Create bot: template-first

`components/BotCreateModal.tsx`, one scroll, three steps:

1. **Pick a template**: Marketing Content, Research Assistant, Inbox Triage,
   Study Buddy, Data Analyst, Blank. Prefills name/title/persona/skills.
2. **Identity**: name, title, emoji, one-line description.
3. **Advanced** (collapsed): model, skills, extensions. No workspace picker
   (L3) and no shell toggle in the main flow (L4).

### Bot chat

`ChatView` is reused as-is; `AppShell` renders `components/BotHeader.tsx`
above it when the session has a bot:

- emoji + name + title; model chip; Files button (existing panel works off the
  session cwd).
- menu: **New conversation** · **Compact** · Edit profile · Duplicate · Pin ·
  Hide · Delete.
- the session-name pencil and folder chip are hidden in bot mode; the composer
  placeholder becomes `Message Aria…`.

`components/BotProfilePanel.tsx` (drawer, tabs):

- **Profile** — name/title/emoji/description/persona (big textarea), model.
- **Skills** — attach from the library, inline create/edit (name, description,
  body); warning if a skill is attached to a tool set without `read`/`bash`.
- **Conversations** — active + archived list (title, date, open, delete); New
  conversation lives here too.
- **Advanced** — extensions, `useGlobalSkills`, "restart to apply".

A new `hooks/useBots.ts` mirrors `useProjects`
(list/refresh/create/update/delete/duplicate/threads). `ChatView` and
`usePiSession` need no changes.

---

## 11. Conversations and compaction (mechanics)

- **New conversation**: archive the active `bot_threads` row, create a new
  session row (cwd = managed workspace, provider/model inherited from the bot,
  name = bot name) + `bot_threads` row, all in one transaction. No pi process
  is spawned until the first prompt (lazy contract). The old conversation's
  pi session file is untouched; opening it later resumes it with the bot's
  *current* config (prompt changes apply to old conversations on resume —
  desirable).
- **Switch active**: set `archivedAt` on the current, clear it on the target,
  same transaction.
- **Delete conversation**: destroyClient + delete session row (messages
  cascade) + delete thread row. Deleting the last conversation is blocked
  (a bot always has one).
- **Compact**: existing control action; no new code.
- Conversation titles: derived from the first user message
  (`messagePreview`, truncated); fall back to the date. Renaming is a later
  nicety.

---

## 12. Capabilities, safety, trust

- **Sandbox by default**: file-scoped tools, shell off (L4).
- **Capability panel** from `GET /api/bots/[id]`: "Can read and write files in
  its own workspace. Cannot run shell commands. Has 3 skills. Inherits your
  global pi extensions."
- **No self-executing project resources**: `--no-approve` (L9) means files the
  bot writes (`.pi/settings.json`, extensions, skills) are ignored on the next
  spawn.
- **Extension attach is a trust decision**: only existing files, with a
  warning that extensions execute arbitrary code as the PiBot user.
- **Secrets**: personas may contain brand details; they live in the local DB
  and are sent only to the model provider. Do not put API keys in a persona.
- **Workspace deletion** happens with the bot (managed data); the delete
  confirm names the folder and the Files panel is how users keep files.
- **Process budget**: one bot = one active process; the existing cap/LRU
  reaper applies.

---

## 13. Templates (v1 content)

Pure data in `lib/bots/templates.ts`, unit-tested:

1. **Marketing Content Bot** — brand voice, content calendar, channel drafts;
   skills `content-planning`, `brand-voice`.
2. **Research Assistant** — briefs with sources and confidence; skill
   `research-brief`.
3. **Inbox Triage** — classify/draft replies from pasted email (no connectors
   yet); skill `reply-drafting`.
4. **Study Buddy** — explains at a chosen level, quizzes you.
5. **Data Analyst** — CSV/XLSX in the workspace, produces summaries.
6. **Blank** — empty persona, `files` preset.

Built-in skills seed the `skills` table on first run (`builtin = true`,
editable, restorable).

---

## 14. Memory — deferred, with reasoning

Decision (L6): **no memory subsystem in v1.** The concern raised in review was
correct: with one long-lived conversation, a separate memory layer is mostly
redundant.

Why v1 can skip it:

- pi persists the whole conversation to its JSONL session file, so the
  conversation *is* durable memory across restarts.
- When the context window fills, pi auto-compacts (summarizes) older turns —
  the user keeps continuity without a notes system.
- Durable rules ("never use emoji", "our brand is X") belong in the persona /
  description, which always applies, including after New conversation.
- The bot has file tools: power users can ask it to keep notes in its
  workspace (`notes/brand.md`) and read them when relevant. That's enough
  without new machinery.

When it *does* earn its keep: after the user starts using **New conversation**
regularly, or complains that compaction dropped specifics. The minimal design
then:

1. A `notes` markdown field on the bot, injected via
   `--append-system-prompt runtime/notes.md` (one new column is fine once the
   migration story below is fixed).
2. Optional bundled pi extension `pibot-memory.ts` exposing a `remember` tool
   appending to `PIBOT_BOT_MEMORY_FILE`; the bot updates its own notes
   deliberately, not via background auto-learning.
3. Auto-learning only if explicitly requested, and always as a reviewable
   suggestion — Grok's own docs stress memory is not an authoritative source.

**Migration blocker:** adding the `notes` column later needs `ALTER TABLE`
and therefore the first drizzle baseline + idempotent bootstrap (see §6). That
chore is coupled to this feature, so schedule it with memory, not with Bots.

---

## 15. Routines — deferred (v2+)

Design preserved so it can be picked up later without rethinking:

- `bot_routines` table: `id, botId, name, prompt, scheduleJson, timezone,
  enabled, lastRunAt, lastStatus, lastError, createdAt`.
- `lib/bots/schedule.ts` (pure, unit-tested with fixed clocks): next-run math
  for `hourly | daily | weekdays | weekly`. Preset-based, no cron library, so
  non-technical users cannot write invalid expressions.
- `lib/bots/scheduler.ts` follows the existing sweeper pattern
  (`setInterval(...).unref?.()`, 60 s): find due+enabled routines; skip and
  record `skipped` if the bot is busy; otherwise `ensureClient` + `prompt` and
  record `ok`/`error`. Bounded by the process cap.
- UI: **Routines** tab (next run, enable/pause, Run now, last 20 results).
- Copy: "PiBot must be running for routines to fire."
- Trust defaults borrowed from Grok: draft/read-first; writes still gated by
  the tool preset.

---

## 16. Team / group chat — deferred (v2+)

Multi-thread bots via `bot_threads` (already in the schema) and a shared
conversation that fans a prompt out to N bots, preserving handoffs in one
transcript. Not designed in detail here; noted so v1 choices don't block it.

---

## 17. Phases, deliverables, tests

TDD applies to every phase: each item starts with a failing test.

### Phase 0 — shared session core (recommended first, §5)

- [ ] Serialized/atomic `persistMessages` + concurrency regression test
- [ ] Safe truncation of large messages + round-trip test
- [ ] `lib/session-preview.ts` extraction, no N+1, unit tests
- [ ] Route-level gaps: DELETE-while-streaming, session PATCH, lifecycle
- [ ] Missing-working-directory state
- [ ] `bun run check` green

### Phase 1 — Bot core (persona chat)

- [ ] `lib/bots/spec.ts` + `test/bot-spec.test.ts` (flags, presets, skills,
      extensions, precedence)
- [ ] `lib/bots/prompt.ts` + `test/bot-prompt.test.ts` (framing, variables)
- [ ] `lib/bots/materialize.ts` + `test/bot-materialize.test.ts` (temp dirs,
      SKILL.md frontmatter, pruning, workspace creation)
- [ ] fake-pi argv dump + system-prompt reporting
- [ ] `rpc-client.ts` spawn options + assertions in `test/rpc-client.test.ts`
- [ ] manager resolution, `respawnClient`, deferred restart
      (`test/bot-manager.test.ts`, using `FAKE_PI_SLOW_TURN_MS` for the busy
      case)
- [ ] schema + fallback DDL + `test/db.test.ts` additions (incl. the
      one-active-thread invariant)
- [ ] API routes + `test/bots-api.test.ts`: CRUD, duplicate copies config not
      history, **create/list never spawn**, `?kind=work` filtering,
      conversation archive/switch/delete transaction semantics
- [ ] templates + `test/bot-templates.test.ts`
- [ ] UI: sidebar toggle (hydration test), create modal, `useBots`,
      `BotHeader`, profile panel with Conversations
- [ ] `bun run check` green

### Phase 2 — Skills & tools

- [ ] skills CRUD + `bot_skills` + attach UI
- [ ] materialization → spawn flags integration test asserting
      `--no-skills --skill …/SKILL.md`
- [ ] capability panel copy
- [ ] extension discovery + `--no-extensions` restriction
- [ ] warning for skills-without-`read`/`bash`

### Phase 3 — Polish

- [ ] Files panel defaults / empty state for bots
- [ ] conversation rename
- [ ] duplicate/export niceties

### Phase 4+ — deferred features

- [ ] Memory (§14, with the drizzle migration baseline chore)
- [ ] Routines (§15)
- [ ] Team/group chat (§16)

### Verification (every phase)

`bun test` (including `test/hydration.test.ts`) + `bunx tsc --noEmit` +
`bun run lint` + `bun run build`, plus a manual pass against a scratch dev
server with a temp `DATABASE_URL` (never `data/pibot.db`): create a bot from a
template → chat → confirm the persona (e.g. it refuses to act like a coding
assistant) → edit profile → confirm the restart toast → confirm Projects shows
no bot entries → New conversation → confirm history is listed and reopening
works → Compact → confirm it runs.

---

## 18. Risks and gotchas

1. **Ancestor `AGENTS.md` leak** — the #1 footgun (L9). A regression test must
   assert `--no-context-files` is present for bot spawns.
2. **Arg length limits** — always pass prompt file paths, never inline text
   (L8); assert flags carry paths.
3. **Stale prompts on live processes** — handled by L10; test idle and busy
   paths.
4. **`--tools` vs skills** — a tool set without `read`/`bash` silently hides
   attached skills (pi behavior); warn in the UI and capability panel.
5. **`PI_EXTRA_ARGS` conflicts** — bot flags are appended after `extraArgs()`
   so they win; document that a `--system-prompt` in `PI_EXTRA_ARGS` is
   overridden for bot sessions only.
6. **One-active-thread invariant** — enforce in a transaction; test
   double-clicks and concurrent requests.
7. **Deleting a bot deletes its workspace** — the confirm must name the
   folder; Files panel is the escape hatch.
8. **Token cost of long personas** — every turn carries them; keep skills
   progressive-disclosure (descriptions in prompt, body on load) and show a
   size hint in the persona editor.
9. **Self-modifying bots** — `--no-approve` keeps bot-written project
   resources inert. Never pass `--approve` for bots.
10. **First drizzle migration** — do not generate one casually: `migrate()`
    would run plain `CREATE TABLE` against existing DBs. New tables via
    fallback DDL only (§6); the baseline chore lands with the first
    `ALTER TABLE` feature (memory).
11. **Bot previews and `?kind=work`** — forgetting the filter dumps bot
    workspaces into Projects; covered by an API test.
12. **Message-cache correctness** — Phase 0 items 1–2 are prerequisites; a
    large document exchange with a bot is exactly the workload that triggers
    both bugs.

---

## 19. Remaining open questions

1. **Sequence**: run Phase 0 first (recommended) or start Bots immediately and
   carry the two message-cache fixes inside Phase 1?
2. **Beta gating**: ship Bots behind an env flag (`PIBOT_ENABLE_BOTS=1`) so
   the Projects workload is untouched until the user is happy with it?
   Recommendation: yes, one flag, removed once stable.
3. **Conversation titles**: auto-from-first-message (recommended) or always
   "Conversation <n> · <date>"?
4. **Emoji vs initial avatars**: emoji picker (recommended, no uploads) or a
   colored initial? Image avatars are explicitly later.
