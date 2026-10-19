# CloudWorx Integration Service

The backend-for-frontend for an industrial sales workspace. A React frontend shows a 3D electrical room and a tool sidebar. This service fills that sidebar with data from the enterprise systems for the selected item (sizing, catalogue and pricing). It enforces permissions, rate limits and time budgets on the server.

The enterprise systems are mocked. The frontend is out of scope.

> **Status:** setup in progress. The commands below are the target interface and will work once the matching steps are built.

## Architecture

A modular monolith in one Express process.

```
Browser (React, untrusted)
   │  HTTPS, Bearer JWT
   ▼
Integration API (Express)
   ├─ core/auth          verify JWT, build caller context
   ├─ core/entitlements  "may this caller see X?"
   ├─ core/resilience    cache, retry, circuit breaker, rate limiter, timeout
   ├─ modules/*          sidebar, items (resize), projects (BOM)
   └─ adapters/*         one per system
          ├─ Sizing mock     :4001
          ├─ Catalogue mock  :4002
          └─ Pricing mock    :4003

PostgreSQL: projects, items, BOM lines, price snapshots
Redis:      cache entries, rate-limit counters
```

The full target architecture is in [docs/architecture_Integration_application.jpg](docs/architecture_Integration_application.jpg).

### Built vs. design document only

| Built in code | Design document only |
|---|---|
| Adapters with cache, retry, circuit breaker and rate limit | BullMQ queue, separate worker, DLQ |
| Sidebar, re-size and BOM endpoints | Outbox write-back to the host, host webhooks |
| JWT auth and entitlements | Catalogue bulk sync and change feed |
| Postgres working copy of items and BOM | Blob storage, document vault, signed URLs |
| | Private LLM, monitoring, Key Vault |

## Folder structure

```
src/
  server.ts, app.ts
  config/          zod-validated env, TTLs, limits
  core/            auth, entitlements, resilience, errors, http, logger
  adapters/        sizing, catalogue, pricing
  modules/         sidebar, items, projects
  repositories/    interfaces, postgres and memory implementations
  db/              pool, migrations, seed
  mocks/           sizing, catalogue, pricing mock servers
scripts/           make-token.ts
tests/             unit, integration
```

## Prerequisites

- Node.js 20+
- Docker with Docker Compose

## Run

```bash
cp .env.example .env
docker compose up -d --wait
npm install
npm run db:migrate
npm run db:seed
npm run mocks
npm run dev
```

Docker Compose starts PostgreSQL 16 and Redis 7 from their official images. They are exposed on host ports `55432` and `56379` so they don't clash with a local Postgres or Redis. To change these ports, set `POSTGRES_HOST_PORT` and `REDIS_HOST_PORT`, and update `DATABASE_URL` and `REDIS_URL` to match.

`db:migrate` applies the numbered SQL files in `src/db/migrations`. `db:seed` loads project `PRJ-1` with three drives, a cabinet and a safety panel. You can run both commands more than once without harm.

Set `REPOSITORY=memory` in `.env` to run without Postgres.

## Tokens

Tokens are mock JWTs, signed locally. The command takes a role and a country:

```bash
npm run token -- sales_engineer IN
npm run token -- channel_partner IN
npm run token -- administrator IN
npm run token -- channel_partner DE DISTRIBUTOR 1h
```

The arguments are `<role> <country> [customerGroup] [expiresIn]`. `customerGroup` defaults to `OEM` and `expiresIn` to `8h`. The script prints only the token, so you can capture it with `TOKEN=$(npm run -s token -- ...)`. Tokens are signed with `JWT_SECRET`, `JWT_ISSUER` and `JWT_AUDIENCE` from `.env`.

| Role | Sees prices |
|---|---|
| `sales_engineer` | yes |
| `administrator` | yes |
| `channel_partner` | never |

## Endpoints

```bash
TOKEN=$(npm run -s token -- sales_engineer IN)

curl -H "Authorization: Bearer $TOKEN" http://localhost:3000/items/DRV-03/sidebar

curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"powerKw":75,"voltage":400}' \
  http://localhost:3000/items/DRV-03/resize

curl -H "Authorization: Bearer $TOKEN" http://localhost:3000/projects/PRJ-1/bom
```

Each sidebar section returns one of these statuses:

| Status | Meaning |
|---|---|
| `ok` | Fresh data |
| `stale` | Cached data, because the system failed, timed out or its circuit is open |
| `unavailable` | The system failed and there is no cached data |
| `not_permitted` | The caller is not entitled to this section |

## Behaviour

- **Time budget:** the sidebar responds within 1 s, with a timeout of about 800 ms per section. Re-size allows about 5 s.
- **Cache TTLs:**

  | System | TTL |
  |---|---|
  | Catalogue | 1 h |
  | Sizing | 15 min, keyed by input hash |
  | Pricing | 10 min, never past `validUntil` |

- **Retries:** at most 2, with exponential backoff and jitter. They apply only to timeouts, 5xx and 429 responses.
- **Circuit breaker:** on sizing.
- **Rate limits:** Redis token buckets, 20 req/s for sizing and 5 req/s for pricing.
- **Prices:** the entitlement check runs before the cache and the adapter. Channel partners get no price fields at all.

## Tests

```bash
npm test
npm run lint && npm run typecheck
```

Tests use in-memory repositories and inject the mocks' delay and failure rate, so the results are deterministic.

## Assumptions

- Postgres holds a working copy of projects. The host application stays the source of truth.
- Prices are per variant, country and customer group, and use the caller's country.
- `item_id` never changes, including after a re-size.

## AI tools used

- **Claude Code (Claude Opus 5.5)** in VS Code. Guided by [claude.md](claude.md), it was used to read the architecture diagram, write the README and scaffold and implement the service step by step.
- Every prompt is logged in [docs/prompts.txt](docs/prompts.txt).
