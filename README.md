# CloudWorx Integration Service

The backend-for-frontend for an industrial sales workspace. A React frontend shows a 3D electrical room and a tool sidebar. This service fills that sidebar with data from the enterprise systems for the selected item (sizing, catalogue and pricing). It enforces permissions, rate limits and time budgets on the server.

The enterprise systems are mocked. The frontend is out of scope.

## Architecture

A modular monolith in one Express process.

```
Browser (React, untrusted)
   │  HTTPS, Bearer JWT
   ▼
Integration API (Express)
   ├─ core/auth          verify JWT, build caller context
   ├─ core/entitlements  "may this caller see X?"
   ├─ core/resilience    read-through, retry, circuit breaker, rate limiter, timeout
   ├─ modules/*          sidebar, items (resize), projects (BOM)
   └─ adapters/*         one per system
          ├─ Sizing mock     :4001
          ├─ Catalogue mock  :4002
          └─ Pricing mock    :4003

PostgreSQL: projects, items, BOM lines, catalogue variants, sizing results, price snapshots
Redis:      cache entries, rate-limit counters
```

### Read order

Every read follows the same order. An external system is called only when nothing usable is stored.

```
1. Redis cache          fresh hit → return
2. PostgreSQL           fresh row → return, refill Redis
3. Adapter → external   success → write PostgreSQL + Redis → return
                        failure → newest stored value as "stale", else "unavailable"
```

The entitlement check runs before step 1, so a caller who may not see prices never touches the price cache, the price table or the pricing system.

The order is implemented once in `src/core/resilience/readThrough.ts`, and `src/sources/createSources.ts` applies it to each system. Adapters only call their external system.

The full design (diagram, flows, technology choices, sequences and assumptions) is in [docs/architecture.pdf](docs/architecture.pdf). The editable diagram is [docs/architecture (2).drawio](docs/architecture%20(2).drawio).

### Built vs. design document only

| Built in code | Design document only |
|---|---|
| Adapters with retry, circuit breaker, rate limit and schema check | BullMQ queue, separate workers, DLQ |
| Read-through cache: Redis → PostgreSQL → adapter | Outbox write-back to the host, host webhooks |
| Sidebar, re-size and BOM endpoints | Catalogue bulk sync and change feed |
| JWT auth and entitlements | Blob storage, document vault, signed URLs |
| PostgreSQL working copy of items and BOM | AI assistant, private LLM, monitoring, Key Vault |

## Folder structure

```
src/
  server.ts, app.ts
  config/          zod-validated env, cache lifetimes, limits
  core/            auth, entitlements, resilience, errors, http, logger
  adapters/        sizing, catalogue, pricing
  sources/         read order per system: Redis → PostgreSQL → adapter
  modules/         sidebar, items, projects
  repositories/    interfaces, postgres and memory implementations
  db/              pool, migrations, seed
  mocks/           sizing, catalogue, pricing mock servers
data/              catalogue.json (served by the catalogue mock)
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

Run `npm run mocks` and `npm run dev` in two separate terminals.

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
  -d '{"motorKw":90,"voltage":400}' \
  http://localhost:3000/items/DRV-03/resize

curl -H "Authorization: Bearer $TOKEN" http://localhost:3000/projects/PRJ-1/bom
```

Each sidebar section returns one of these statuses:

| Status | Meaning |
|---|---|
| `ok` | Fresh data |
| `stale` | Stored data, because the system failed, timed out or its circuit is open |
| `unavailable` | The system failed and nothing usable is stored |
| `not_permitted` | The caller is not entitled to this section |

Re-size returns `changed: true` with the BOM change when the recommended variant differs, `changed: false` when it doesn't, and `503` when sizing is down and no stored result exists. The item's `item_id` never changes.

## Behaviour

- **Time budget:** the sidebar responds within 1 s, with a timeout of about 800 ms per section. Re-size allows about 5 s.
- **Cache lifetimes:**

  | System | Redis key | PostgreSQL table | Fresh for |
  |---|---|---|---|
  | Catalogue | `cat:{variantCode}` | `catalogue_variants` | 1 h |
  | Sizing | `size:{hash(inputs, apiVersion)}` | `sizing_results` | 7 days |
  | Pricing | `price:{variant}:{country}:{group}` | `price_snapshots` | until the quote's `validUntil` (24 h), never after |

- **Retries:** at most 2, with exponential backoff and jitter. They apply only to timeouts, 5xx and 429 responses.
- **Circuit breaker:** on sizing. While it is open, the sizing mock is not called.
- **Rate limits:** Redis token buckets shared by every process: 18 req/s for sizing and 4.5 req/s for pricing, below the vendor limits of 20 and 5. Both are set in `.env`.
- **Prices:** the entitlement check runs before the cache, the database and the adapter. Channel partners get no price fields at all.

## Tests

```bash
npm test
npm run typecheck
```

Tests use in-memory repositories and inject the mocks' delay and failure rate, so the results are deterministic.

## Assumptions

- Microsoft Entra ID is the identity provider in production. It authenticates users and issues the role, country and customer group claims; this service makes every authorisation decision from those claims. Locally, `scripts/make-token.ts` stands in for it.
- The vendor rate limits apply to the whole service, not to each user.
- A sizing result depends only on its inputs and the sizing API version, so it is reused for 7 days. A price is reused while its quote is valid (24 h) and never after.
- When an external system is down, users prefer the last known data, marked `stale`, over an empty panel.
- A re-size updates the existing item's variant and stored sizing result. The item keeps its `item_id`.
- PostgreSQL holds a working copy of projects. The host application stays the source of truth.
- Prices are per variant, country and customer group, and use the caller's country.

## AI tools used

- **Claude Code (Claude Opus 5.5)** in VS Code. Guided by [claude.md](claude.md), it was used to review the architecture diagram against the assessment, write the design document, write this README, and scaffold and implement the service step by step.
- Every prompt is logged in [docs/prompts.txt](docs/prompts.txt).
