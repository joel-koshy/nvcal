# Backend instructions

## Platform documentation

Cloudflare Workers APIs and limits change frequently. For any Workers, D1, Queues, OAuth deployment, runtime, or binding task, retrieve current documentation before making decisions.

- Workers: https://developers.cloudflare.com/workers/
- Node.js compatibility: https://developers.cloudflare.com/workers/runtime-apis/nodejs/
- Limits: https://developers.cloudflare.com/workers/platform/limits/
- Errors: https://developers.cloudflare.com/workers/observability/errors/
- Product references: `/d1/`, `/queues/`, `/durable-objects/`, `/r2/`, `/kv/`, `/workflows/`
- Cloudflare MCP: `https://docs.mcp.cloudflare.com/mcp`

For Durable Objects or Workflows, also consult the applicable best-practices documentation. Use the limits page for CPU, memory, request, D1, and Queue quota claims rather than relying on memory.

## Architecture

This package is a Hono Cloudflare Worker backed by D1 and Queues:

- `src/app.ts` mounts authenticated `/api/*`, `/auth`, `/webhooks`, and the page route `/`.
- `src/routes/api/` contains event, calendar, and Google sync endpoints.
- `src/routes/auth/` contains password and Google OAuth flows.
- `src/routes/webhook/` receives provider callbacks.
- `src/queue/` processes Google export/import and webhook jobs.
- `src/util/` contains crypto, OAuth, and typed-response helpers.
- `src/routes/page.ts` validates bootstrap data with `PageStateSchema` and injects it into the compiled frontend HTML.

The frontend artifact is built in `web/dist/index.html`, then copied into the generated `src/generated/template.ts` module by `scripts/compile-template.js`. The generated template is ignored; regenerate it instead of editing it manually.

Bindings are defined in `src/types.ts` and `wrangler.jsonc`. They include D1, the sync Queue, JWT configuration, Google OAuth values, and `APP_URL`. After changing bindings, run `npm run cf-typegen -w backend` and review the generated declarations.

## API and data rules

- Keep authentication and ownership checks server-side. Never accept a user ID from a request body.
- Validate request bodies and query parameters with `@nvcal/domain` schemas or a narrowly scoped route schema using `zValidator`.
- Validate successful JSON response bodies through `typedJson(c, schema, body, status)` and the matching `@nvcal/domain` response schema.
- Preserve optimistic-concurrency `version` checks on event and calendar updates/deletes.
- Keep shared entities and contracts in `packages/domain/src/`; do not duplicate domain schemas in the Worker.
- Treat `schema.sql` as destructive: it starts by dropping tables. Do not run a remote reset casually.
- Keep JWT secrets, OAuth secrets, and tokens in Worker secrets/bindings, never in source or committed local configuration.

## Commands

Run from the repository root unless noted:

```sh
npm run web:build
npm run build-template -w backend
npm test --workspace nvcal-backend -- --run
npm run start -w backend
npm run deploy -w backend
npm run cf-typegen -w backend
npm run db:reset -w backend   # destructive local D1 reset; use intentionally
```

The backend tests use `@cloudflare/vitest-pool-workers`, Wrangler, and the local D1 schema. The backend test suite currently passes. When diagnosing a failure, run the smallest relevant test file first, then the full `--run` suite.

`npm run dev` at the repository root builds the frontend and starts the backend development flow. The backend `dev` script also compiles the frontend template and starts `scripts/dev.js`, which expects `cloudflared` for its tunnel-assisted workflow. Use `npm run start -w backend` for plain Wrangler development when a tunnel is not needed.

## Deployment and verification

The production workflow builds the web artifact, compiles the Worker template, and deploys with Wrangler. Before deployment:

1. Run the domain typecheck and frontend build.
2. Run the backend tests.
3. Regenerate the frontend template with `npm run build-template -w backend`.
4. Review route/schema changes and `backend/wrangler.jsonc` bindings.
5. Confirm secrets and Google OAuth redirect configuration are supplied through the deployment environment.

Do not apply `schema.sql` remotely without an explicit migration/reset plan; the file contains `DROP TABLE` statements.

## Error and runtime guidance

For Error 1102 or any Cloudflare runtime-limit issue, consult the current Workers limits and observability documentation before changing code. Do not add Node-only APIs to Worker request paths unless the current Node.js compatibility documentation confirms support and the project configuration enables it.
