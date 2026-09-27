---
name: verify
description: Run apps/web as a production build against a local disposable Postgres in a cloud session and drive it through the browser or HTTP to observe a change. Use to verify a PR at runtime.
---

# Verify apps/web at runtime

Cloud sessions have no `apps/web/.env.local` and cannot reach `fetha-preview`, so run the app
against a local Postgres behind Neon's local proxy, the same setup CI uses (ADR-0016).

## Database

```bash
(nohup dockerd > /tmp/dockerd.log 2>&1 &)
docker network create fnet
# Docker Hub answers 429: use the ECR mirror.
docker run -d --name postgres --network fnet -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=main \
  -p 5432:5432 public.ecr.aws/docker/library/postgres:17
docker run -d --name neonproxy --network fnet \
  -e PG_CONNECTION_STRING=postgres://postgres:postgres@postgres:5432/main -p 4444:4444 \
  ghcr.io/timowilhelm/local-neon-http-proxy:main
grep -q db.localtest.me /etc/hosts || echo "127.0.0.1 db.localtest.me" >> /etc/hosts
docker exec postgres psql -U postgres -d main \
  -c "CREATE SCHEMA IF NOT EXISTS neon_control_plane" \
  -c "CREATE TABLE IF NOT EXISTS neon_control_plane.endpoints (endpoint_id VARCHAR(255) PRIMARY KEY, allowed_ips VARCHAR(255))"
```

## Env

```bash
export DATABASE_URL=postgres://postgres:postgres@db.localtest.me:5432/main
export ALLOW_DISPOSABLE_DATABASE=1
export BETTER_AUTH_SECRET=<any 40+ chars>
export BETTER_AUTH_URL=http://localhost:3000
export REGISTRATION_MODE=open
export MAILER=capture   # mail lands in the mail_outbox table
```

Then `pnpm install --frozen-lockfile` and `pnpm --filter @fetha/web run db:migrate`.

## Gotcha: the app cannot reach the local proxy as shipped

`src/db/client.ts` uses the Neon serverless driver, which is bundled into the server chunks, so
`scripts/lib/local-neon.mjs` (used by tests) does not reach it and every query fails with an
`ErrorEvent`. For a local run only, never committed, add before `drizzle(...)` in `getDb()`:

```ts
neonConfig.fetchEndpoint = (h) => `http://${h}:4444/sql`;
neonConfig.useSecureWebSocket = false;
neonConfig.wsProxy = (h) => `${h}:4444/v2`;
```

(with `import { neonConfig } from "@neondatabase/serverless";`). Use a git worktree for the PR
under test so the patch never lands on a branch.

## Run and drive

```bash
pnpm --filter @fetha/web run build
cd apps/web && pnpm exec next start -p 3000   # background it; GET /api/auth/ok → {"ok":true}
```

- Browser: `chromium.launch({ executablePath: "/opt/pw-browsers/chromium" })` from
  `@playwright/test` in `apps/web`. Localhost works; vercel.app does not (proxy CA).
- Sign-up through the UI: `/cadastro` (Nome, E-mail, both checkboxes, "Criar conta"), read the
  link with `select text from mail_outbox where "to"='<email>'`, open it, set the password on
  `/definir-senha` ("Salvar senha"). Selectors match `e2e/support.ts`.
- HTTP: Better Auth lives under `/api/auth/*`. Its rate limiter keys by `x-forwarded-for` and
  runs before `hooks.before`: `/sign-in`, `/sign-up` and `/change-password` allow 3 requests per
  10 s, so send a fresh `x-forwarded-for` per probe or a 429 hides the real answer.
- For a before/after, check out `origin/main` in the same worktree (the local patch carries over),
  rebuild and repeat.

Reset the database: drop both `public` and `drizzle` schemas, then recreate `public`.
