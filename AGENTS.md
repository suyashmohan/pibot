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
  `ensureClient` dedupes concurrent spawns via in-flight map. Spawning is
  lazy; idle processes are reaped (`sweepIdleClients`, 60s sweeper) and
  concurrency is capped (`enforceProcessCap`, LRU idle eviction, busy
  sessions spared). `entry.client` is nullable — reap keeps the entry and
  emitter so respawn is transparent.
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
  `app/api/processes` — live pi subprocess inventory (`GET`) + manual
  stop/kill (`POST /api/processes/stop`, SIGTERM or `force`=SIGKILL);
  `stopProcess` keeps the managed entry so the next prompt respawns
  transparently, exactly like idle reaping. Surfaced by `ProcessPanel`
  (opened from the AppShell strip).
- `app/api/sessions/[id]/files/{browse,content,raw}` — one directory level,
  text preview, and raw bytes (thumbnails, full image view, downloads) for
  the right-side file browser. `?dir=`/`?path=` are relative to the session
  cwd, guarded by `resolveWithinRoot`; `raw` never serves html/js content
  types and is CSP-sandboxed. Pure helpers in `lib/file-browser.ts`,
  highlight.js registry in `lib/highlight.ts` (only mapped languages),
  `hooks/useFileBrowser.ts`, `components/FileBrowser.tsx` +
  `FileEntries.tsx` (list/gallery) + `FilePreview.tsx` (image lightbox,
  code, markdown Rendered/Source).
- `hooks/usePiSession.ts`, `hooks/useProjects.ts`,
  `hooks/useMediaQuery.ts`, `components/*`
  (project-grouped `Sidebar` — drawer on mobile, static from `md` up —
  `ChatView`, `Composer`, …).

## Gotchas (learned the hard way)

- `bun run build` forces `NODE_ENV=production`. With an ambient
  `NODE_ENV=development` Next 16.3 crashes while prerendering its internal
  `/_global-error` page (`TypeError: null is not an object (evaluating
  'k.H.useContext')`) — the build is red for environmental reasons, not code.
- Dynamic filesystem paths in app routes trip Turbopack's "tracing the whole
  project" warning. The intentional ones (`lib/files.ts`) carry
  `path.join(/* turbopackIgnore: true */ …)`; keep it that way when adding
  new dynamic reads.
- Next 16 refuses a second `next dev` for the same project dir. E2E against
  a scratch server should use `bun run start` (production build) on a scratch
  port with a scratch `DATABASE_URL`.
- The SSE stream emits **named** events (`event: agent_start` …).
  `EventSource.onmessage` NEVER fires for those — the hook registers
  `addEventListener` per event name. Do not regress this.
- Route `params` is a `Promise` (`await params`). All API routes:
  `runtime = "nodejs"`, `dynamic = "force-dynamic"`.
- SSR/hydration: first client render must be byte-identical to SSR HTML.
  Never read `window` / `localStorage` / `matchMedia` / `navigator` during
  render or in `useState` initializers — hydrate such prefs in `useEffect`
  (sidebar visibility is CSS-owned tri-state, collapse prefs load on
  mount; see `lib/layout.ts`). A `typeof window` branch that changes
  output is a hydration mismatch.
- `Bun.spawn` does NOT inherit post-start `process.env` mutations —
  `rpc-client.ts` passes `env: { ...process.env }` explicitly. Never rely
  on ambient env reaching pi children (this silently broke stub-controlled
  tests and would hide runtime-set provider keys).
- `better-sqlite3` is gone; `serverExternalPackages` needs no sqlite entry.
- `data/.gitkeep` keeps the default DB dir in git; custom `DATABASE_URL`
  parents must pre-exist (fail-fast by design).
- Verify with `bunx tsc --noEmit` + `bun run build`; E2E against a dev
  server on a scratch port without touching the user's sessions in
  `data/pibot.db`.

## Testing discipline (TDD — non-negotiable)

- Tests are Bun-native in `test/` and run with `bun test` (sub-second,
  no network, no real LLMs). Current coverage: pure units (`utils`,
  message helpers, `Emitter`, `env`, `files`), sqlite schema behavior on
  temp DBs, and protocol/integration tests (`rpc-client`, `manager`)
  against `test/helpers/fake-pi.ts` — an executable stub `pi --mode rpc`
  agent selected via the `PI_BINARY` env var.
- Red-green-refactor, faithfully:
  1. Write the failing test FIRST capturing the new behavior or reported
     bug, and watch it fail.
  2. Implement the minimal change that turns it green.
  3. Refactor only while the suite stays green.
- Every bug fix lands with a regression test that fails without the fix
  (e.g. the named-SSE-events subscription is covered by the prompt
  event-order test — stream behavior must stay observable, not just
  REST-fetchable).
- Every bug REPORT starts with reproduction: write the failing test before
  touching source, watch it fail, then fix. A fix without a failing-first
  test is not done (the mobile-hydration crash is the cautionary tale —
  the suite was green because no test rendered SSR vs client output).
- Test isolation rules: temp `DATABASE_URL` files via
  `freshDb()`/`cleanupDbs()`, unique session ids, `destroyClient` after
  each manager test. Never touch `./data/pibot.db`, never spawn the real
  `pi`, never hit the network in tests.
- When adding features: extend the suite first and keep ALL existing tests
  passing. No breaking changes to established behavior without explicit
  user approval.
- Done means done: `bun test` (all green, INCLUDING
  `test/hydration.test.ts` — SSR `renderToString` with zero browser
  globals, then `hydrateRoot` in a mobile-simulated happy-dom with seeded
  `localStorage`, asserting zero hydration warnings) + `bunx tsc --noEmit`
  + `bun run build` (Next type-checks, so a red suite or red types is a red
  build). Never ship on red. Never delete, skip, or weaken a failing test
  to make the suite pass — only remove tests for intentionally-removed
  behavior, and say so explicitly.
