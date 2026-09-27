# NVCAL repository instructions

## Project overview

NVCAL is a VIM-navigable calendar application in an npm-workspaces monorepo:

```text
nvcal/
├── packages/domain/   # @nvcal/domain: shared Zod schemas and inferred types
├── backend/           # Hono Cloudflare Worker, D1, Queues, OAuth, API
└── web/               # Preact + TypeScript SPA, built as one HTML artifact
```

The application is intended to be delivered by the Worker as a single HTML response. The frontend build currently produces an inlined `web/dist/index.html`, plus `.br`, `.gz`, and `stats.html` artifacts. The 14.6 KB compressed transfer target is a hard design constraint, but it is not currently met: the latest local build was approximately 16.52 kB gzip and 14.66 kB Brotli. Re-measure after frontend changes rather than assuming the budget passes.

## Repository conventions

- Use native `Date` APIs for calendar/date calculations. Do not add heavy date or UI dependencies.
- Put shared entities, request schemas, and response schemas in `packages/domain/src/`; import them from both applications. Frontend domain imports should remain type-only when runtime validation is unnecessary.
- Keep API response validation centralized through `backend/src/util/typed.ts` and use the matching `@nvcal/domain` response schema for successful JSON responses.
- Preserve optimistic-concurrency `version` checks on event and calendar mutations.
- Treat `backend/schema.sql` as destructive because it begins by dropping tables. Use `backend/seed.sql` and the existing `db:reset` command only when a local database reset is intended.
- Preserve existing user changes. In particular, do not overwrite unrelated edits in `web/src/panes/SidebarCalendars.tsx` or generated/build-audit files.

## Frontend

The frontend entry point is `web/src/main.tsx`; the root composition is in `web/src/app.tsx`. UI is organized into:

- `web/src/panes/`: `SidebarMonth`, `SidebarCalendars`, `MainWeek`, and `Topbar`.
- `web/src/components/`: `DialogBox`, `DraftBlock`, `EventBlock`, and `Timeslot`.
- `web/src/hooks/`: event/calendar data hooks and the VIM engine.
- `web/src/utils/`: API wrapper and native-JavaScript date helpers.
- `web/src/types/`: UI and API route-map types.

VIM navigation is provided by `web/src/hooks/vim/VimProvider.tsx`. `usePane()` registers a pane’s flow, columns, and macro-neighbors; `useNavigable()` registers focusable nodes. Lowercase `h/j/k/l` moves within a pane, while uppercase `H/J/K/L` follows the pane-neighbor graph. `VimDialog` in `web/src/components/DialogBox.tsx` is an island pane with no macro-neighbors; its close/reposition behavior is the wormhole back to the originating node.

The Vite alias is currently implemented with `path.resolve(__dirname, './src')` in `web/vite.config.ts`. Do not document or rely on a different alias implementation unless it is changed in the config. The build uses `vite-plugin-singlefile`, `vite-plugin-compression2`, `rollup-plugin-visualizer`, and Terser. Terser is configured with `drop_console: false` and `drop_debugger: false` at present, so debug logging still affects the bundle.

`web/index.html` must retain the empty favicon data URI (`<link rel="icon" href="data:,">`) to avoid a second SPA fallback request. Since JavaScript is inlined, deployment CSP must allow inline scripts (`script-src 'unsafe-inline'`). Never use `dangerouslySetInnerHTML`; use normal Preact bindings for user data. Validate any future user-controlled URL before binding it to an `href`.

## Backend

`backend/src/app.ts` mounts:

- `/api/*` behind the JWT cookie middleware and user-id loader.
- `/auth` for password and Google authentication.
- `/webhooks` for provider callbacks.
- `/` for the HTML page route.

The page route (`backend/src/routes/page.ts`) performs soft session authentication, loads the current user’s week and calendars, validates the bootstrap with `PageStateSchema`, and injects JSON initial state into the compiled HTML. The HTML template is generated at `backend/src/generated/template.ts` by `backend/scripts/compile-template.js`; this generated file is ignored and should be regenerated instead of hand-editing it.

Backend integrations include Cloudflare D1, Queues, and Google Calendar OAuth/synchronization. Bindings are described in `backend/src/types.ts` and configured in `backend/wrangler.jsonc`. Changes to bindings require `npm run cf-typegen -w backend` and review of the generated worker declarations.

## Commands

From the repository root:

```sh
npm ci                         # install all workspace dependencies
npm run domain:typecheck       # typecheck @nvcal/domain
npm run web:build              # typecheck and build the single-file frontend
npm run build-template -w backend # copy web/dist/index.html into Worker source
npm test --workspace nvcal-backend -- --run
npm run dev                    # build frontend, then start the local Worker flow
```

The backend test suite uses `@cloudflare/vitest-pool-workers` and the local Wrangler/D1 environment. It may require permission to write Wrangler logs and bind a local address in restricted environments.

Before handing off frontend work, inspect `web/dist/index.html`, `web/dist/index.html.gz`, `web/dist/index.html.br`, and `web/stats.html`. Before handing off backend changes, run the relevant Vitest tests and verify route/schema changes against the shared domain contracts.

## Security

- Keep ownership checks server-side; never trust a user ID from request bodies.
- Validate request bodies/query parameters with the shared Zod schemas or a narrowly scoped route schema.
- Keep OAuth tokens and JWT secrets in Worker secrets/bindings, never source files.
- Avoid HTML injection in both the bootstrap state and rendered UI. If rich text is ever introduced, sanitize it before rendering.

## More specific instructions

When working under `backend/`, also follow `backend/AGENTS.md`; it requires current Cloudflare documentation for Worker, D1, Queue, and related platform tasks. `web/AGENTS.md` is currently empty.
