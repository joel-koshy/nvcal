# Database

This directory contains the D1 database lifecycle files:

- `migrations/` contains numbered, forward-only schema changes. Apply these
  locally with `npm run db:migrations -w backend`, or to the configured remote
  D1 database with `npm run db:migrations:remote -w backend`.
- `seeds/` contains optional local or environment-specific data. Seeds are
  not migrations and should be run deliberately.
- `reset.sql` is destructive and is only used by the local `db:reset` script.

For a new schema change, add the next numbered migration. Do not edit an
already-applied migration; create a new one so local and deployed databases
can converge safely.

Production migrations run in CI before the Worker deploy. Do not run the
destructive reset or demo seed against production. Prefer backward-compatible
expand/contract changes when a schema change and application change must be
released together.
