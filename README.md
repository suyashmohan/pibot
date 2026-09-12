# PiBot — Web GUI for the Pi coding agent

Single-user Next.js + Tailwind CSS v4 webapp that drives **`pi --mode rpc`**
(the Pi.dev agent's JSON-RPC mode) through a modern dark chat interface.

- **One web session = one `pi --mode rpc` subprocess** running in the session's
  working directory (where `read` / `write` / `edit` / `bash` operate).
- **Live streaming** via Server-Sent Events: text/thinking deltas, tool
  progress, queue updates, compaction + retry status.
- **Full RPC coverage**: prompt / steer / follow-up / abort / clear-queue,
  models + thinking levels, compact, bash, fork / clone / new session,
  export HTML, session tree, and the **extension UI dialog protocol**
  (`select` / `confirm` / `input` / `editor` render as modals).
- **Project-grouped sidebar**: sessions nest under their project folder
  (auto-discovered from session working directories, plus pinnable folders
  via `POST /api/projects`). Collapse state persists in localStorage.
- **Persistent storage**: Drizzle ORM + SQLite (`bun:sqlite`) caches
  sessions and messages locally. Pi's own JSONL session files remain the
  source of truth; the DB is reconciled from `get_messages`.

## Stack

- **Bun only** — the server must run on the Bun runtime (`bun --bun`).
  `bun:sqlite` cannot load under Node, so Node compatibility is intentionally
  not maintained. Running under Node fails fast with a clear error.
- Next.js (App Router) + React 19
- Tailwind CSS v4 (`@import "tailwindcss"`)
- Drizzle ORM + `bun:sqlite` (built into Bun — no native addon to compile;
  DB file in `./data/pibot.db`, WAL mode)
- `lucide-react` icons, `react-markdown` + `remark-gfm` message rendering

## Prerequisites

- Bun 1.2+ (**required** — the app uses `bun:sqlite`, `Bun.spawn`,
  `Bun.Glob` and `Bun.$`, none of which exist under Node)
- The `pi` binary on `PATH` (or set `PI_BINARY`), authenticated
  (`pi /login` or provider API keys — the webapp inherits the server env).

## Setup

```bash
cp .env.example .env   # adjust DATABASE_URL / PI_BINARY / PI_DEFAULT_CWD
bun install
bun run dev            # http://localhost:3000
```

The npm scripts invoke `bun --bun ...` internally, so `npm run dev` also
lands on the Bun runtime. If you bypass the scripts (e.g. `npx next dev`),
the server refuses to start with `PiBot must run on the Bun runtime`.

Production:

```bash
bun run build
bun run start
```

SQLite needs no separate server. The default `./data/` directory ships with
the repo; a custom `DATABASE_URL` path must already exist (the server
refuses to start with a clear error otherwise).

## Testing (TDD)

```bash
bun test
```

Bun-native suite in `test/` (see AGENTS.md for the testing discipline):
unit tests for utils, message helpers, emitter, env parsing and files;
SQLite schema tests on throwaway temp DBs; protocol and manager
integration tests against `test/helpers/fake-pi.ts`, a stub
`pi --mode rpc` agent selected via `PI_BINARY` — so no test touches real
LLMs, the network, or `./data/pibot.db`.

## Configuration (`.env`)

| Var | Default | Purpose |
| --- | ------- | ------- |
| `DATABASE_URL` | `file:./data/pibot.db` | SQLite file for drizzle |
| `PI_BINARY` | `pi` | Path to the pi agent binary |
| `PI_DEFAULT_CWD` | `process.cwd()` | Default tool sandbox for new sessions |
| `PI_EXTRA_ARGS` | _(empty)_ | Extra args for every `pi --mode rpc` spawn |
| `PI_RPC_TIMEOUT_MS` | `120000` | Request/response timeout |

## How it works

```
Browser ──fetch/SSE──▶ Next.js API routes ──JSONL stdin/stdout──▶ pi --mode rpc
                              │
                              ▼
                     drizzle + SQLite cache
```

- `lib/pi/rpc-client.ts` — Bun-native JSONL client: `Bun.spawn` with piped
  stdio, `TextDecoder` framing (splits on LF only, strips trailing CR,
  correlates `id` → response promise), tiny local `Emitter` instead of
  `node:events`.
- `lib/files.ts` — Bun-native fs helpers (`Bun.Glob` probes for directory
  checks). `node:path` is still used for pure string path math — Bun has no
  equivalent module for that, and it runs natively under Bun.
- `lib/pi/manager.ts` — process-lifetime singleton: spawn/respawn per web
  session (concurrent spawns deduped via an in-flight map), SSE fan-out,
  `agent_settled` → `get_messages` → SQLite sync.
- `app/api/sessions/**` — CRUD + prompt/control/model/stats/tree/lifecycle/
  bash/extension-ui/stream endpoints.
- `app/api/projects` — pinned + discovered project folders (backed by the
  `settings` table).
- `lib/runtime.ts` — Bun-only guard (`assertBunRuntime`).
- `lib/emitter.ts` — tiny event emitter used for RPC + SSE fan-out.
- `hooks/usePiSession.ts` — SSE consumer: assembles streaming text/thinking/
  tool-call drafts, holds dialogs + toasts, polls stats while streaming.
- `hooks/useProjects.ts` — project list + pin/unpin.
- `components/*` — project-grouped sidebar, chat, composer (steer/follow-up
  queueing, image attach), tool cards, model picker, extension dialogs.

### Notes

- Next.js route handlers can't hold WebSockets without a custom server, so
  agent events stream over **SSE** (`GET /api/sessions/[id]/stream`) while
  commands are plain `POST`s whose `response` resolves the HTTP call.
  The stream emits **named** events (`event: agent_start` …) — browser
  `EventSource` only delivers those to per-name `addEventListener`
  listeners, never to `onmessage`. The hook subscribes to each name
  explicitly; don't "simplify" it back to `onmessage`.
- `getDb()` is **async** (Bun's I/O APIs are async-only) — every server
  caller must `await` it. Concurrent callers share one in-flight open.
- `better-sqlite3` is gone: `bun:sqlite` is listed in no config at all — it's
  part of the runtime, so there is no `serverExternalPackages` entry and no
  postinstall compile step. The existing `data/pibot.db` file (plain SQLite)
  is reused as-is.
- If the pi process dies, the UI shows a toast; opening the session respawns
  it and re-attaches to the same pi session file.
