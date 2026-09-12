<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

<!-- PiBot project rules (safe to edit — outside the Next-managed block above) -->

# PiBot — agent notes

Single-user Next.js web GUI driving `pi --mode rpc` (Pi coding agent
JSON-RPC over stdin/stdout). **Bun-only runtime**: `bun:sqlite`,
`Bun.spawn`, `Bun.Glob`, `Bun.$` — no Node compatibility. Run via
`bun run dev` / `bun run build` / `bun run start` (scripts force
`bun --bun` internally, so `npm run dev` works too). Never `npx next dev`.

## Layout

- `lib/pi/rpc-client.ts` — JSONL client on `Bun.spawn`. Strict framing:
  split stdout on LF only, strip one trailing CR, `id` → response promise.
- `lib/pi/manager.ts` — one `pi` process per web session, SSE fan-out,
  `ensureClient` dedupes concurrent spawns via in-flight map.
- `lib/db/` — drizzle + `bun:sqlite`. **`getDb()` is async** — always
  `await` it. Pi's JSONL files are source of truth; sqlite is a cache
  synced from `get_messages`.
- `lib/runtime.ts` (`assertBunRuntime`), `lib/emitter.ts` (tiny emitter),
  `lib/files.ts` (`dirExists`/`hasSqlMigrations` via `Bun.Glob`).
  `node:path` is fine (string math, no Bun equivalent); no other `node:`
  imports — keep it that way.
- `app/api/sessions/**` — session CRUD, prompt/control/model/stats/tree/
  lifecycle/bash/extension-ui/stream. `app/api/projects` — pinned +
  discovered project folders (stored in sqlite `settings` table).
- `hooks/usePiSession.ts`, `hooks/useProjects.ts`, `components/*`
  (project-grouped `Sidebar`, `ChatView`, `Composer`, …).

## Gotchas (learned the hard way)

- The SSE stream emits **named** events (`event: agent_start` …).
  `EventSource.onmessage` NEVER fires for those — the hook registers
  `addEventListener` per event name. Do not regress this.
- Route `params` is a `Promise` (`await params`). All API routes:
  `runtime = "nodejs"`, `dynamic = "force-dynamic"`.
- `better-sqlite3` is gone; `serverExternalPackages` needs no sqlite entry.
- `data/.gitkeep` keeps the default DB dir in git; custom `DATABASE_URL`
  parents must pre-exist (fail-fast by design).
- Verify with `bunx tsc --noEmit` + `bun run build`; E2E against a dev
  server on a scratch port without touching the user's sessions in
  `data/pibot.db`.
