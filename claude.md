# CLAUDE.md

Guidance for Claude (and any AI assistant) working in this repository.

> **Confidentiality:** This project is a hiring assessment. Do not copy the original assessment PDF or large parts of its wording into the repo. If the repo is public, keep this file free of anything beyond what is needed to build the service.

> **Scope:** This is a **lean build** of the architecture in the design document. Build the required core first. Anything marked *optional* is done only after the core is complete and all tests pass. Everything else (queues, workers, outbox, webhooks, catalogue sync, LLM) lives in the design document, not in code.

---

## 1. What this project is

The **integration service (backend-for-frontend)** for an industrial sales workspace. A React frontend shows a 3D electrical room (drives and cabinets placed on a floor grid) and a tool sidebar. Each sidebar panel shows data from one enterprise system for the item selected in 3D.

This service sits between that frontend and the enterprise systems. It **cannot change those systems**: it must respect their rate limits, permissions and outages, and still give the user a fast, coherent sidebar.

Only the **backend** is built here. The enterprise systems are **mocked**. The React frontend is out of scope.

---

## 2. Non-negotiable rules

1. **Permissions are enforced on the server.** Never send a price the caller may not see and rely on the UI to hide it.
2. **Every sidebar section has a status.** One failing system must never blank the whole sidebar.
3. **The sidebar responds within 1 s**, even when systems are slow or down.
4. **An item's identity (`item_id`) never changes**, including after a re-size. Variant, model reference, BOM line and price hang off it.
5. **Respect external rate limits:** sizing 20 req/s, pricing 5 req/s (whole service). Limits are global, so counters live in Redis, not in process memory.
6. **Adapters are isolated.** Modules never call an enterprise system directly; they go through its adapter.
7. **Small, correct and tested beats wide and fragile.**
8. **Code must run on the first try from the README.**

---

## 3. Tech stack

| Concern | Choice | Why |
|---|---|---|
| Runtime | **Node.js 20+**, **TypeScript** (strict) | Async I/O suits fan-out; types document the panel contract |
| HTTP | **Express** | Simple, well known, easy to change live in review |
| Database | **PostgreSQL** (via `pg`) | Relational data (project → item → variant → BOM line); a transaction keeps re-size consistent |
| Cache, rate limits | **Redis** (via `ioredis`) | Shared TTL cache and global rate-limit counters across replicas |
| Validation | **zod** | Validates env config, request bodies and vendor responses (catches vendor API changes) |
| Auth | **jose** | JWT sign and verify (signature, issuer, audience, expiry) |
| Logging | **pino** | Structured JSON logs with request IDs |
| Tests | **Vitest** + **supertest** | Fast; HTTP-level tests against the real Express app |
| Local infra | **Docker Compose** | Postgres and Redis with one command |

No queue library in the core. No extra infrastructure without a written reason.

---

## 4. Architecture

**Modular monolith BFF**, one process.

```
Browser (React, untrusted)
   │  HTTPS, Bearer JWT
   ▼
Integration API (Express)
   ├─ core/auth          verify JWT, build caller context (role, country, customerGroup)
   ├─ core/entitlements  single place for "may this caller see X?"
   ├─ core/resilience    cache, retry, circuit breaker, rate limiter, timeout
   ├─ modules/*          sidebar, items (resize), projects (BOM)
   └─ adapters/*         one per system, built on core/resilience
          │
          ├─ Sizing mock     (slow, 20% failures)
          ├─ Catalogue mock  (static JSON)
          └─ Pricing mock    (rate-limited, prices by country)

PostgreSQL: projects, items, BOM lines, price snapshots
Redis:      cache entries, rate-limit counters
```

**Built here vs. design document only**

| Built in code | Design document only |
|---|---|
| Adapters with cache, retry, breaker, rate limit | BullMQ queue, separate worker, DLQ |
| Sidebar, re-size, BOM endpoints | Outbox write-back to host, host webhooks |
| JWT auth + entitlements | Catalogue bulk sync and change feed |
| Postgres working copy of items and BOM | Blob storage for glTF, document vault, signed URLs |
| | Private LLM, monitoring, Key Vault |

**Why not microservices:** modest scale (600 concurrent sessions), the real bottlenecks are external rate limits that splitting would not raise, sidebar fan-out is faster in-process, and fewer moving parts means a smaller security surface. Adapters are isolated modules, so any one can be extracted later.

---

## 5. Folder structure

```
.
├── CLAUDE.md
├── README.md
├── docker-compose.yml          # postgres + redis
├── .env.example
├── package.json
├── tsconfig.json
├── src/
│   ├── server.ts               # starts the Integration API
│   ├── app.ts                  # builds the Express app (importable by tests)
│   ├── config/
│   │   └── env.ts              # zod-validated config, incl. TTLs and limits
│   ├── core/
│   │   ├── auth/               # JWT verify middleware, caller context
│   │   ├── entitlements/       # canSeePrice(caller)
│   │   ├── resilience/         # cache.ts, retry.ts, circuitBreaker.ts, rateLimiter.ts, withTimeout.ts
│   │   ├── errors/             # typed errors + Express error handler
│   │   ├── http/               # request ID, logging middleware
│   │   └── logger.ts
│   ├── adapters/
│   │   ├── types.ts            # Adapter interface, SectionResult type
│   │   ├── sizing/             # client.ts, adapter.ts, schema.ts
│   │   ├── catalogue/
│   │   └── pricing/
│   ├── modules/
│   │   ├── sidebar/            # route, service (fan-out + statuses)
│   │   ├── items/              # resize route, service
│   │   └── projects/           # BOM route, service
│   ├── repositories/
│   │   ├── types.ts            # ItemRepository, BomRepository interfaces
│   │   ├── postgres/           # pg implementations
│   │   └── memory/             # in-memory implementations (tests, fallback)
│   ├── db/
│   │   ├── pool.ts
│   │   ├── migrations/         # plain SQL, numbered
│   │   └── seed.ts             # sample project with placed items
│   └── mocks/                  # mock enterprise systems (separate Express apps / ports)
│       ├── sizing/server.ts
│       ├── catalogue/server.ts
│       ├── catalogue/catalogue.json
│       └── pricing/server.ts
├── scripts/
│   └── make-token.ts           # signs local mock JWTs for each role
└── tests/
    ├── unit/                   # breaker, retry, entitlements, cache
    └── integration/            # sidebar, resize, BOM via supertest
```

**Module rules**
- `modules/*` may import from `core/*`, `adapters/*` and `repositories/types`. Never from another module's internals.
- `adapters/*` never import from `modules/*`.
- Entitlement checks happen in `core/entitlements`, called by the service layer before data leaves the API.
- Services depend on repository **interfaces**; `REPOSITORY=postgres|memory` in env selects the implementation. Postgres is the default; memory keeps tests fast and is a fallback if Docker is unavailable.

---

## 6. Mock enterprise systems (required)

| Mock | Port | Behaviour |
|---|---|---|
| Sizing | 4001 | `POST /size` with motor data. Random delay **0.5–3 s**. Fails **20%** of requests (HTTP 503). Returns recommended `variantCode` and load %. |
| Catalogue | 4002 | Serves `catalogue.json`: product models, variants (code, IP rating, options, dimensions, `modelRef` for glTF with 3 LODs). |
| Pricing | 4003 | `GET /prices/:variantCode?country=XX`. Rate limit **5 req/s**; returns **429** with `Retry-After` when exceeded. Price, currency, lead time (days), `validUntil` (24 h). |

Delay and failure rate are **configurable via env** and injectable in tests so tests are deterministic. Never rely on real randomness in a test.

---

## 7. API contract

All endpoints need `Authorization: Bearer <jwt>`.

### `GET /items/:itemId/sidebar`
Fans out to catalogue, sizing and pricing **in parallel** and returns within **1 s**. Each section has its own timeout (about 800 ms) so the total stays inside the budget.

```json
{
  "itemId": "DRV-03",
  "variantCode": "ACS-R7-75-400",
  "sections": {
    "catalogue": { "status": "ok", "data": { "...": "..." }, "fetchedAt": "..." },
    "sizing":    { "status": "stale", "data": { "...": "..." }, "fetchedAt": "..." },
    "pricing":   { "status": "not_permitted", "data": null }
  }
}
```

Section status values (core):

| Status | Meaning |
|---|---|
| `ok` | Fresh data |
| `stale` | Cached data served because the system failed, timed out or its circuit is open |
| `unavailable` | System failed and no cached data exists |
| `not_permitted` | Caller is not entitled to this section |

Sizing in the core is a **direct call with a timeout**: fresh result → `ok`; timeout or failure → cached result as `stale`, else `unavailable`.

### `POST /items/:itemId/resize`
Body: motor/load data.
1. Call sizing through the adapter (with retries; the user is waiting on this action, so allow up to about 5 s here, not the 1 s sidebar budget).
2. If the recommended variant **changed**: in **one Postgres transaction**, update the item's `variant_code` and `model_ref`, update its BOM line, bump `version`.
3. Return the BOM change:

```json
{
  "itemId": "DRV-03",
  "changed": true,
  "previous": { "variantCode": "ACS-R6-55-400", "modelRef": "models/r6" },
  "current":  { "variantCode": "ACS-R7-75-400", "modelRef": "models/r7" },
  "bomChange": { "removed": { "...": "..." }, "added": { "...": "..." } }
}
```

- Variant unchanged → `changed: false`, no write.
- Sizing unavailable or circuit open → `503` with a clear message; the item is not changed.

### `GET /projects/:projectId/bom`
All items with quantities and prices. Prices are **filtered by the caller's entitlement**: a channel partner gets lines with **no price fields at all** and a `pricing: "not_permitted"` marker. Prices use the caller's **country**.

---

## 8. Identity and entitlements

- Mock JWTs are signed locally (`scripts/make-token.ts`). Claims: `sub`, `role`, `country`, `customerGroup`, `iss`, `aud`, `exp`.
- Verify **signature, issuer, audience and expiry** on every request; failure → `401`.
- Roles: `sales_engineer`, `channel_partner`, `administrator`.
- **Price visibility:** `sales_engineer` and `administrator` see prices; `channel_partner` never does. Prices are for the caller's country.
- For a caller who may not see prices, **do not call the pricing adapter at all**.
- Price cache is **shared** by key `variant + country + customerGroup`; the entitlement check runs **before** serving from cache.

---

## 9. Caching, retries, circuit breaker, rate limits

| System | Cache key | TTL | Notes |
|---|---|---|---|
| Catalogue | `cat:{variantCode}` | 1 h | Changes rarely |
| Sizing | `size:{hash(inputs)}` | 15 min | Same inputs → same result |
| Pricing | `price:{variant}:{country}:{group}` | 10 min | Never serve past the quote's `validUntil` (24 h) |

- TTLs live in config, one explicit value per system.
- Cache entries store `fetchedAt`. Keep the raw entry longer than its freshness TTL so it can still be served as `stale` during an outage.
- **Retries:** up to 2, exponential backoff with jitter, only on timeouts, 5xx and 429 (respect `Retry-After`). Never retry 4xx validation errors. Retries must fit inside the caller's time budget.
- **Circuit breaker (sizing):** opens when the failure rate exceeds a threshold over a rolling window, half-opens after a cool-down, closes after a successful probe. While open, the sizing mock is not called.
- **Rate limiters:** Redis-backed token buckets for sizing (20/s) and pricing (5/s), values from config so they can be changed live (for example, pricing to 1/s).

---

## 10. Data model (PostgreSQL)

```
projects        (project_id PK, name, updated_at)
items           (item_id PK, project_id FK, kind, variant_code, model_ref,
                 position jsonb, motor_input jsonb, version, updated_at)
bom_lines       (bom_line_id PK, project_id FK, item_id FK UNIQUE, variant_code, quantity)
price_snapshots (variant_code, country, customer_group, amount, currency,
                 lead_time_days, valid_until, PK(variant_code, country, customer_group))
```

The host application is the real source of truth for projects; Postgres holds the working copy. Write-back to the host (outbox) is design-document only.

---

## 11. Commands

```bash
docker compose up -d          # postgres + redis
npm install
npm run db:migrate
npm run db:seed
npm run mocks                 # starts sizing, catalogue, pricing mocks
npm run dev                   # Integration API
npm run token -- sales_engineer IN   # print a mock JWT
npm test                      # uses in-memory repositories and injected mock behaviour
npm run lint && npm run typecheck
```

Keep `README.md` in sync with these scripts.

---

## 12. Required tests

1. **Partial results:** sizing fails or times out → sidebar still returns within 1 s, catalogue `ok`, sizing `stale` or `unavailable`.
2. **Circuit breaker:** after repeated failures it opens and the sizing mock is no longer called.
3. **Rate limit:** pricing 429 → retried with backoff, or the section degrades to `stale`/`unavailable`.
4. **Entitlements:** sales engineer sees prices in sidebar and BOM; channel partner gets `not_permitted` and **no price fields anywhere in the JSON**.
5. **Token checks:** expired, wrong issuer, wrong audience or bad signature → 401.
6. **Re-size:** variant changes → item, model reference and BOM line updated together, BOM change returned; variant unchanged → no write; sizing down → 503 and nothing changed.

Tests inject the mocks' delay and failure rate; no flaky timing.

---

## 13. Order of work

**Required core (in order):**
1. Docker Compose, config, migrations, seed
2. Three mocks
3. Resilience helpers (cache, retry, breaker, rate limiter, timeout)
4. Three adapters
5. Sidebar endpoint with statuses
6. Auth, entitlements, BOM endpoint
7. Re-size endpoint
8. Tests and README

**Optional (only after the core is green, in this order):**
1. **Adapter registry:** adding a 4th system is one new adapter folder plus one registration line, with no change to other adapters or the sidebar service.
2. **Server push for slow sizing:** add a `pending` status, queue the sizing call (BullMQ), and deliver the result over SSE (`GET /events`, `sizing.completed`). Dedupe jobs by input hash.
3. **MCP tools:** `get_item_details` and `get_bom_cost` (reuse the same adapters and entitlements), plus `resize_item`, which refuses without an explicit `confirmed: true` from the user and writes an audit log entry.
4. **Mock OIDC issuer:** JWKS endpoint; verify signature, issuer, audience and expiry against it.
5. **Hardening:** `Idempotency-Key` on re-size, optimistic locking (`version` → 409 on conflict).
6. **Dockerfile and CI workflow.**

---

## 14. Conventions

- TypeScript `strict`; no `any` in adapter or contract types.
- Validate every vendor response with a zod schema in the adapter. A schema failure is logged loudly and treated as `unavailable`; this is how a vendor API change is caught early.
- Never log tokens, or prices for unentitled users.
- Every log line carries a request ID.
- Keep Express handlers thin (parse → service → respond); logic lives in services.
- Do not add new infrastructure (queues, Kafka, Elasticsearch, extra services) in the core. Fewer moving parts is a goal.

---

## 15. README must include

- Prerequisites and exact run steps (works on first try)
- How to generate tokens for each role
- Example `curl` calls for every endpoint
- How to run tests
- What is built vs. described only in the design document
- Assumptions made
- **Which AI tools were used and how** (required by the assessment)