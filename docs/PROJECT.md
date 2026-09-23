# PiBot — project briefing

Written after a full codebase review (2026-09-20). Use this to pick up work
without re-deriving how the app is put together. `README.md` is the user
manual; `AGENTS.md` is the coding contract. This file is the map.

## What it is

PiBot is a **single-user, self-hosted web GUI** for the [Pi coding agent](https://pi.dev).
It does not implement an agent. It drives an existing `pi --mode rpc` subprocess
over JSONL on stdin/stdout, and presents that as a dark chat UI.

One web session = one `pi` process, spawned in that session's working directory
(the folder `read` / `write` / `edit` / `bash` operate in). Pi's own JSONL
session files under `~/.pi` are the source of truth. SQLite is a cache.

It is **not** a multi-user product. Anything that can reach its HTTP port is
equivalent to a shell on the machine running the server. Default bind is
loopback (`127.0.0.1`). Docker is the recommended way to run it so that shell
lives in a container.

Repo: https://github.com/suyashmohan/pibot — MIT, author Suyash Mohan.
Tested against **pi 0.85.x** (Docker pins `0.85.1`). Version `0.1.0`.

## Stack

| Layer | Choice | Why it matters |
| ----- | ------ | -------------- |
| Runtime | **Bun only** (`bun:sqlite`, `Bun.spawn`, `Bun.Glob`, `Bun.$`) | Node is refused at startup. `npx next dev` will fail. |
| Web | Next.js 16 App Router + React 19 | `proxy.ts` is Next 16's renamed middleware. Route `params` is a `Promise`. |
| CSS | Tailwind v4 | `md` = 768px is the mobile/desktop split (`lib/layout.ts`). |
| DB | Drizzle + `bun:sqlite`, WAL | `getDb()` is **async**. Always `await` it. |
| Agent | `pi --mode rpc` JSONL | Fake stub in `test/helpers/fake-pi.ts` for tests. |
| Deploy | One Docker image (Bun + Node + `pi`) | Compose publishes `127.0.0.1` only. |

Scripts: `bun run dev` / `start` go through `scripts/next.ts` (forces bind
host). `bun run check` = test + tsc + eslint. There is no `next lint`.

## How a request becomes agent output

```
Browser  ── fetch + EventSource ──▶  Next.js API routes
                                          │
                     ┌────────────────────┼────────────────────┐
                     ▼                    ▼                    ▼
              SQLite cache         PiRpcClient            request-guard
              (sessions,           (Bun.spawn             (Host / CSRF /
               messages,            pi --mode rpc)         optional token)
               settings)
                                          │
                                          ▼
                                   pi JSONL session file
                                   (source of truth)
```

1. User focuses the composer → `POST /api/sessions/[id]/start` →
   `ensureClient(id)` spawns `pi --mode rpc` in the session `cwd`, optionally
   with `--session <file>` to resume.
2. User sends a prompt → `POST .../prompt` → JSONL `{ type: "prompt", ... }`.
3. Pi emits named events (`agent_start`, `message_update`, `tool_execution_*`,
   `agent_settled`, …). The manager fans them out over SSE as raw `PiEvent`s.
4. `hooks/usePiSession.ts` subscribes via `pibot.sessions.subscribe`
   (`lib/client/stream.ts`): it registers **per event name** (not `onmessage` —
   named SSE events never hit `onmessage`) and folds each event through the
   single projector (`lib/control/projector.ts`) into snapshot `SessionEvent`s
   and streaming-draft state, then refreshes the cached transcript after settle.
5. On `agent_settled` / `compaction_end`, the manager calls `get_messages` and
   replaces the SQLite message rows for that session.

Commands are plain POSTs. Live updates are SSE. Next route handlers cannot
hold WebSockets without a custom server, so this split is intentional.

## Layers

```
lib/client (PiBotClient, EventSource + projector)
      │  fetch / SSE
app/api/**  (thin: parse params → control → ok/fail)
      │
lib/control (domain: sessions, runtime, files, projects, processes, health,
             policy, subscribe; ControlError carries explicit HTTP status)
      │  domain methods only
lib/pi (host.ts writes JSONL names; manager spawn/reap/fan-out; rpc-client)
      │
pi --mode rpc  ──▶ ~/.pi JSONL (source of truth)
```

Import rules (enforced by `eslint.config.mjs` + `test/import-fences.test.ts`):
UI imports `@/lib/client` or `@/lib/control/types`/`projector` — never the
`@/lib/control` server barrel, `@/lib/pi/*`, or `@/lib/db`. `app/api/**`
imports `@/lib/control` only. `lib/client` stays bundle-safe (no `bun:*`,
`next/server`, `@/lib/db`). One rule: JSONL command names are written only in
`lib/pi/host.ts`.

Supervisor-agent doors (designed, not built): stdio in the same OS process
importing `control`, or a separate `PiBotClient` process on loopback with
`Cookie: pibot_token=...`. No internal MCP HTTP route, no second listener,
no second manager.

## Process lifetime (the important invariant)

Spawning is **lazy on user intent**. Viewing a session must never start `pi`.

| Path | Spawns? |
| ---- | ------- |
| `GET /api/sessions`, `GET /api/sessions/[id]`, `/messages`, `/stats`, SSE `/stream` | No. Cache / `live: false`. |
| Read-only `POST /control` (`get_commands`, `get_fork_messages`, `get_last_assistant_text`) | No if asleep. |
| `POST /api/sessions/[id]/start` (composer focus) | Yes. |
| `POST /prompt`, `/bash`, mutating `/control`, `/lifecycle`, `/model` POST | Yes (`ensureClient`). |
| `GET /api/sessions/[id]/model` | **Yes** (opens the model picker). Slight leak of the lazy-spawn idea. |
| `GET /api/sessions/[id]/tree` | **Yes**, and the UI never calls it. |
| `GET /api/models` | Spawns the **shared metadata** process. UI never calls it. |

Concurrent spawns for the same session share one in-flight promise, so REST +
SSE cannot orphan two `pi` processes.

Idle processes are reaped every 60s after `PI_IDLE_TIMEOUT_MS` (default 15 min).
`PI_MAX_PI_PROCESSES` (default 10) LRU-evicts idle ones. **Busy** sessions
(streaming or compacting) are never reaped. Reap nulls `entry.client` but
keeps the managed entry and SSE emitter, so respawn is transparent.

`stopProcess` (Process panel) is the same contract: SIGTERM (or SIGKILL if
`force`), entry survives, next prompt respawns.

A **global** client (`ensureGlobalClient`, `--no-session`) exists for
server-side model listing. It is **not** idle-reaped.

State lives on `globalThis` (`__pibotManaged`, `__pibotInflight`,
`__pibotGlobalClient`, `__pibotDbPromise`) so Next's module graph cannot
create a second manager.

## Data model

`lib/db/schema.ts`:

- **`sessions`** — web id (`nanoid(12)`), name, cwd, provider/model/thinking,
  `piSessionId` / `piSessionFile`, timestamps. 1:1 with a pi subprocess when
  live.
- **`messages`** — cache of pi messages. `content_json` truncated at 200k,
  `raw_json` at 500k. On sync the table is **deleted then re-inserted**.
- **`settings`** — key/value. Currently `pinned_projects` (JSON array of
  absolute paths).

There is **no `drizzle/` migrations directory in git** (`.gitignore` ignores
`drizzle/*.sql` and `drizzle/meta/`). `getDb()` falls back to inline
`CREATE TABLE IF NOT EXISTS`. Adding a column later will **not** migrate
existing `data/pibot.db` files.

Deleting a web session destroys the process and the sqlite row. **Pi's JSONL
file is kept on disk.** There is no UI to import those orphans back.

## Security boundary

All decisions live in `lib/request-guard.ts`. `proxy.ts` is a thin Next
adapter. Do not inline security in routes.

1. **Host allowlist** on every method (DNS-rebinding). Loopback names plus
   `PIBOT_ALLOWED_HOSTS`.
2. **Same-origin** for non-GET (CSRF), including `no-cors` + `text/plain`
   that skips CORS preflight. `readJson()` parses any body, so this check is
   load-bearing.
3. Optional **`PIBOT_TOKEN`** cookie, minted by `GET /?token=...`.

`lib/file-browser.ts` + `resolveWithinRoot` keep session file APIs inside the
session cwd. Raw file responses never use `text/html` / script types and are
CSP-sandboxed.

The **folder picker** (`GET /api/projects/folders`) lists arbitrary
directories on the machine. That is by design for a local tool and is the
main reason LAN exposure needs `PIBOT_TOKEN` plus a tunnel/VPN.

## UI map

Single page: `app/page.tsx` → `AppShell`. **No session URLs.** Active session
is React state. A refresh picks the most recently updated session, not
necessarily the one you were in.

| Piece | Role |
| ----- | ---- |
| `AppShell` | Sessions list, project groups, process poll (5s), file-browser toggle (`⌘/Ctrl+Shift+E`), new-session modal. |
| `Sidebar` | Project-grouped sessions, search, pin/unpin folders, process dots (working/idle). Collapse prefs in `localStorage`. |
| `ChatView` | Header (rename, model, compact, bash, clone, export), transcript, composer. |
| `Composer` | Focus → `onIntent` → start pi. `/` slash commands, `@` file mentions, images, steer/follow-up queue. |
| `usePiSession` | SSE consumer, streaming draft (`STREAMING_MESSAGE_ID`), dialogs, toasts. |
| `ThemeMenu` / `ThemeProvider` | Theme switcher in the top strip; registry + storage in `lib/themes.ts`. |
| `FileBrowser` | One directory level under session cwd; list/gallery; image/code/markdown preview. |
| `ProcessPanel` | Live `pi` inventory + stop/kill. |
| `Overlays` | Extension UI modals (`select` / `confirm` / `input` / `editor`) + toasts. |

Hydration rule: first client render must match SSR. Never read `window` /
`localStorage` / `matchMedia` during render. Sidebar visibility is CSS-owned
tri-state (`null` = follow CSS). Covered by `test/hydration.test.ts`.

Theme rule: colors are semantic tokens only (`bg-app`, `bg-panel`, `text-fg`,
`border-line`, …; syntax tokens for code). `test/theme.test.ts` fails if a
component uses a Tailwind palette class or a hex color, or if `globals.css`
misses a token in either theme. `data-theme` on `<html>` is applied by the
pre-paint boot script and `ThemeProvider`, never rendered by React.

## API surface

Under `app/api/`. Every route: `runtime = "nodejs"` (Next label; process is
still Bun), `dynamic = "force-dynamic"`.

- `GET /api/health` — app name, pi binary/version/availability, default cwd, Bun version.
- `GET /api/models` — unused by the UI; wakes the global metadata process.
- `GET/POST /api/sessions` — list (with preview + count) / create (no spawn).
- `GET/PATCH/DELETE /api/sessions/[id]` — detail from cache or live; rename; delete.
- `POST .../start`, `.../prompt`, `.../control`, `.../model`, `.../bash`, `.../lifecycle`, `.../extension-ui`
- `GET .../messages`, `.../stats`, `.../stream`, `.../tree` (tree unused by UI)
- `GET .../files?dir=` — `@` mention listing
- `GET .../files/browse`, `.../content`, `.../raw` — file browser
- `GET/POST/DELETE /api/projects` — pinned + discovered folders
- `GET /api/projects/folders` — filesystem directory picker
- `GET /api/processes`, `POST /api/processes/stop`

JSON envelope: `{ ok: true, data }` or `{ ok: false, error }`.

## File map (where to edit)

| Want to change… | Start here |
| ---------------- | ---------- |
| Control-plane behavior / statuses | `lib/control/**` (`runtime.ts`, `sessions.ts`, `errors.ts`) |
| Browser SDK / stream folding | `lib/client/**` (`pibot.ts`, `stream.ts`, `sse-names.ts`) |
| Spawn / reap / SSE fan-out / message sync | `lib/pi/manager.ts` |
| JSONL command names / RPC timeouts | `lib/pi/host.ts` |
| JSONL framing, stdin write, timeouts | `lib/pi/rpc-client.ts` |
| RPC / message TypeScript shapes | `lib/pi/types.ts` |
| Idle timeout, process cap, binary path | `lib/pi/env.ts` |
| Host / CSRF / token | `lib/request-guard.ts` + `proxy.ts` |
| Bind address | `lib/net.ts` + `scripts/next.ts` |
| Schema | `lib/db/schema.ts` + inline DDL in `lib/db/index.ts` |
| Path jail, listings, previews | `lib/files.ts`, `lib/file-browser.ts` |
| Streaming UI | `hooks/usePiSession.ts`, `components/MessageList.tsx` |
| Theme tokens / registry | `lib/themes.ts`, `app/globals.css`, `components/ThemeProvider.tsx` |
| Composer / mentions / slash | `components/Composer.tsx`, `lib/file-mentions.ts`, `lib/slash-commands.ts` |
| Layout / hydration | `lib/layout.ts`, `hooks/useMediaQuery.ts` |
| Docker | `Dockerfile`, `docker-compose.yml`, `.dockerignore` |
| Fake agent | `test/helpers/fake-pi.ts` |
| Test env (temp DB, `PI_BINARY`) | `test/helpers/test-env.ts` |
| happy-dom / `react-dom/client` | `test/helpers/dom.ts` — **never** import `react-dom/client` at test top level |

`node:path` is allowed (string math). No other `node:` imports.

## Testing

Bun-native, `bun test`, no network, no real `pi`, never `./data/pibot.db`.
TDD is required (`AGENTS.md` / `CONTRIBUTING.md`).

~50 test files. Highlights:

- Control plane: `test/control/**` (projector, sessions, prompt, policy,
  subscribe, files); wire contracts in `test/http-contract/**`; SDK in
  `test/client/**`
- Import fences: `test/import-fences.test.ts` (server barrel, `Bun.spawn`,
  `text_delta` in hooks, hard-coded API URLs)

- Protocol: `rpc-client.test.ts`, `manager.test.ts` against `fake-pi.ts`
- Lazy spawn: `lazy-spawn.test.ts`
- Security: `request-guard.test.ts`, `proxy.test.ts` (imports real `proxy.ts`)
- Hydration: `hydration.test.ts` (SSR `renderToString` then `hydrateRoot`)
- UI units: composer, file browser, sidebar dots, process panel, token stats

`react-dom/client` feature-detects input events at import time. Importing it
before a DOM exists poisons **every** concurrent test in the process. Always
`loadReactDom()` from `test/helpers/dom.ts` after installing happy-dom.

CI (`.github/workflows/ci.yml`): bun latest → test → tsc → eslint → build.

## Docker (recommended run)

One image: `oven/bun:1-debian` + Node 24 (for the `pi` CLI) + globally
installed `@earendil-works/pi-coding-agent@0.85.1`. `tini` is PID 1 — do not
also set `init: true`.

Volumes: `/app/data` (sqlite), `/root/.pi` (auth + JSONL), host
`PIBOT_WORKSPACE` (default `./workspace`) → `/workspace`.

`.gitignore` currently has an uncommitted addition of `workspace` so the
Docker default project folder is not committed.

## Shortcomings and what to improve

Ranked by payoff. None of these are “the app is broken”; they are the next
sensible cuts.

### Product gaps

1. **No session URLs.** Active chat is React state. Refresh, share, and
   browser history cannot restore a specific session. A query param or
   `/s/[id]` route is the highest-leverage UX fix.
2. **Cannot import pi sessions from disk.** Delete keeps the JSONL; nothing
   lists `~/.pi` and attaches a web row to an existing file
   (`switch_session` exists on the lifecycle API).
3. **Fork-from-message is API-only.** `POST /lifecycle { op: "fork", entryId }`
   and `get_fork_messages` exist; the UI only exposes clone + “new pi session”.
   There is no click-a-transcript-row-to-fork.
4. **Transcript search is missing.** Sidebar search is name/preview only.
5. **Extension UI is partial.** `select` / `confirm` / `input` / `editor` /
   `notify` render. `setStatus` / `setWidget` / `setTitle` / `set_editor_text`
   are ignored.
6. **Dead endpoints.** `GET /api/sessions/[id]/tree` and `GET /api/models`
   have no UI callers. Tree always spawns. Models always starts the global
   process. Wire them up or delete them.

### Process and cache

7. **`GET /model` spawns.** Opening the model picker on a sleeping session
   starts `pi`, which contradicts “composer focus is the only wake-up”.
   Serve the last known model from the row, or use the global client.
8. **Message sync is delete-then-insert, not transactional, and truncates.**
   A failed insert after delete empties the cache. Tool output larger than
   500k is silently cut. Wrap in a sqlite transaction; consider upserting
   by identity instead of wiping.
9. **Session list is N+1.** `GET /api/sessions` queries all messages per
   session just to build a preview. Fine for tens of chats; painful later.
   Store preview/count on the session row and update on sync.
10. **Global metadata process never reaped.** First `GET /api/models` (or any
    future caller) leaves a `pi --no-session` running until stop/kill.
11. **Process cap is soft.** If every live process is busy, `enforceProcessCap`
    cannot evict and spawn still proceeds. Document or fail the extra spawn.
12. **`client_exit` toast is wrong.** It says “Reload the session to respawn”;
    focusing the composer already respawns. After a user stop, treat exit as
    idle, not an error.

### Schema and ops

13. **No committed migrations.** Schema evolution is “create if not exists”.
    Un-ignore `drizzle/` (or replace with explicit `ALTER` in `getDb`) before
    the next column is added, or existing user DBs will drift.
14. **CI uses `bun-version: latest`.** A Bun breakage lands as a red main
    without a PiBot change. Pin the engine (`>=1.2.0` is already in
    `package.json`).
15. **Docker runs as root.** Documented; bind-mounted workspace files become
    root-owned on Linux. A non-root default (or compose `user:`) would match
    the “confine the agent” story better.
16. **Pi protocol is a moving target.** Pinned to 0.85.x. A pi major will
    need a compatibility matrix and a health warning when versions diverge
    further than they already do.

### Security / exposure

17. **Folder picker is a full-filesystem listing API.** Correct for
    localhost; dangerous if someone binds `0.0.0.0` and forgets the token.
    Consider restricting browse roots to `PI_DEFAULT_CWD` / pinned projects
    unless an explicit “allow full FS” flag is set.
18. **Images go over JSON as base64.** Fine for screenshots; will hurt on
    large attachments. A future upload path (temp file + RPC image handle)
    would be cleaner if pi supports it.
19. **No rate limit / no audit log.** Acceptable for single-user; the first
    thing to add if this is ever put behind a shared proxy.

### UX polish

20. **Polling instead of events for process dots.** AppShell hits
    `/api/processes` every 5s. The manager already knows; an SSE or a
    short-lived poll after spawn/reap would be snappier and cheaper.
21. **Native `confirm()`** for delete / stop. The rest of the UI is custom
    modals.
22. **No theme-creation UI yet.** Dark + light ship, the registry supports
    runtime themes (`registerTheme` + `--pibot-*` overrides), but there is no
    settings page to build/import one, and no density control.
23. **SSE has no replay.** Reconnect relies on REST refresh. Last-Event-ID
    or a sequence number would close a rare missed-token window.
24. **No formatter in CI.** Eslint warnings are allowed and “should not
    grow” — they will.

### Test gaps

Worth adding before the corresponding features:

- Lifecycle clone/fork/new_session (the clone dance is the trickiest code in
  the API layer and has no dedicated test).
- Bash RPC + abort.
- Extension-ui `writeRaw` round-trip.
- `persistMessages` truncation and a mid-sync failure.
- `GET /model` must not be the thing that accidentally re-breaks lazy spawn
  if you tighten that contract.

## Invariants to not regress

- Viewing a session does not spawn `pi` (`test/lazy-spawn.test.ts`,
  including the locked `GET /model` / `/tree` / `/api/models` leaks).
- Named SSE events are subscribed by name (`PI_SSE_EVENT_TYPES`;
  `test/client/sse-names.test.ts` + `test/client/stream.test.ts`).
- One projector: `pushPiEvent` emits snapshots, `applySessionEvent` replaces
  fields (`test/control/projector.test.ts`); hooks never see `text_delta`.
- `ControlError.status` is explicit (404 vs 500 for “Session not found” is
  intentional; `test/http-contract/**`).
- `proxy.ts` stays a thin adapter; logic stays in `request-guard.ts`.
- `Bun.spawn` gets `env: { ...process.env }` (post-start env mutations are
  invisible to children).
- No static `react-dom/client` import in tests.
- First render is SSR-identical (no `window` in render).
- `tini` stays Docker PID 1; compose does not set `init: true`.
- Tests never touch `./data/pibot.db` or the real `pi` binary.

## How to run

```bash
cp .env.example .env
bun install
bun run dev          # http://127.0.0.1:3000
bun test
bun run check        # test + tsc + eslint
docker compose up --build   # recommended for using it as a tool
```
