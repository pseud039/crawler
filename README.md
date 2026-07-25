# CrawlKit

A composable, ECS-inspired web crawling engine. Instead of a monolithic crawler with hardcoded behavior, every part of the crawl — how pages are fetched, how content is parsed, which links get followed, how politely to crawl, and whether to revisit — is a swappable component assembled from a job config.

Inspired by Factorio's Entity-Component-System model: crawl behavior is composed from small, interchangeable modules rather than baked into one codebase.

## Why

Existing crawlers (Scrapy, Nutch, Apify) are either black-box SaaS products or heavyweight frameworks that don't expose the crawl pipeline as something you can compose. CrawlKit's goal is: define a job's fetcher, parser, link-selection strategy, and politeness policy independently, run it, and get structured JSON (and optionally vector-DB-ready embeddings) out the other end.

**Primary use cases:** LLM/RAG dataset building, focused research crawling, competitive/content monitoring, custom data-extraction pipelines.

## Architecture

```
┌────────────────────────────────────────────────────────────┐
│                      FASTIFY API                            │
│   POST /api/jobs → creates job → seeds frontier → runs pool │
└──────────────────────────┬───────────────────────────────────┘
                           │
              ┌────────────▼─────────────┐
              │      JobScheduler         │
              │  round-robin across jobs  │
              └────────────┬─────────────┘
                           │
┌──────────────────────────▼───────────────────────────────────┐
│                     WORKER POOL (N workers)                   │
│                                                                │
│  1. acquireUrl(jobId)              — Redis lease (atomic)     │
│  2. politeness.getDelay/shouldCrawl                            │
│  3. fetcher.fetch(url)                                         │
│  4. dedupe by content hash → store RawPage                     │
│  5. parser.parse(html, url)                                    │
│  6. store DerivedResult                                        │
│  7. strategy.selectLinks() → pushUrls() back to frontier       │
│  8. releaseUrl(jobId, url, success)                            │
└───────────────┬────────────────────────────────┬─────────────┘
                │                                 │
     ┌──────────▼──────────┐          ┌──────────▼───────────┐
     │   REDIS FRONTIER      │◄───────►│      POSTGRES         │
     │ queue / leased / seen │  sync   │ crawl_jobs, raw_pages, │
     │ domain:rate:{domain}  │         │ derived_results,       │
     │                       │         │ frontier_urls, users   │
     └───────────────────────┘         └────────────────────────┘
```

Each URL flows through the same five-stage pipeline regardless of which concrete components a job selects: **politeness → fetch → parse → strategy (link discovery) → politeness.onCrawled**.

## Components

Every component type is a TypeScript interface; concrete implementations are registered in `packages/core/src/registry.ts` and selected per-job via config string.

| Type | Implemented | Description |
|---|---|---|
| **Fetcher** | `http` | `node-fetch`, 10s timeout. Default, low overhead. |
| | `headless` | Playwright/Chromium. One browser instance reused across fetches, fresh context per page. For JS-rendered pages. |
| **Parser** | `readability` | Mozilla Readability + JSDOM for content extraction, cheerio for link extraction. |
| | `semantic` | Same extraction, plus OpenAI `text-embedding-3-small` embeddings and lightweight regex-based entity extraction. |
| **Strategy** | `bfs` | All valid links, equal priority, capped at 50/page. |
| | `focused` | Scores links by keyword/topic match against url+title; filters by threshold, sorts by score, caps at `maxLinks`. |
| **Politeness** | `standard` | Per-domain delay enforced via Redis, with TTL-based auto-expiry. |
| **Revisit** | `none` | Stub — `shouldRevisit` always returns `false`. No re-crawl logic exists yet. |

New components register via:

```ts
import { registerComponent } from '@crawler/core/src/registry.js';

registerComponent('fetcher', 'my-fetcher', (cfg) => new MyFetcher(cfg));
```

## Data model

Postgres (via Prisma) with one important design choice: **raw content is shared across all jobs, derived output is per-job.**

- `User` — API key auth, plan, quota
- `CrawlJob` — status, component config (JSON), seed URLs, depth/maxPages limits
- `RawPage` — deduped globally by SHA-256 content hash
- `DerivedResult` — per job, per component-type output (JSONB)
- `FrontierUrl` — durable backup of the Redis queue (status: queued/leased/crawled/failed)
- `JobStat` — crawled/queued/failed counts, bytes fetched

Redis holds the hot path: `frontier:job:{id}:queue` (ZSET, score = priority), `:leased` (ZSET, score = lease expiry), `:seen` (SET), and `domain:rate:{domain}` for politeness.

### Lease pattern

`acquireUrl` atomically pops the lowest-score URL from `queue` into `leased` via a Lua script. A 60s lease means a crashed worker's URL gets swept back into the queue by `recoverExpiredLeases`, which runs on a 30s interval. If Redis is ever empty on startup (e.g. after a restart) `rebuildFrontier` reloads pending URLs from Postgres.

## Tech stack

- **Language:** TypeScript, strict mode, ESM throughout
- **Monorepo:** pnpm workspaces + Turborepo
- **Database:** PostgreSQL 17 via Prisma 7 (with `@prisma/adapter-pg`)
- **Queue/cache:** Redis 7 (`ioredis`)
- **API:** Fastify + Zod validation
- **Fetching:** `node-fetch` (HTTP) / Playwright (headless)
- **Parsing:** Mozilla Readability, JSDOM, cheerio
- **Embeddings:** OpenAI `text-embedding-3-small`
- **Vector DB:** Qdrant (Cloud or self-hosted)

## Packages

```
crawler/
├── packages/
│   ├── core/     @crawler/core   — component interfaces, registry, frontier logic
│   ├── db/       @crawler/db     — Prisma schema, client, blob storage helper
│   ├── worker/   @crawler/worker — JobScheduler, worker pool, job runner
│   └── api/      @crawler/api    — Fastify REST API
├── docker-compose.yml   — Postgres 17 + Redis 7
├── pnpm-workspace.yaml
└── turbo.json
```

## Getting started

```bash
# 1. Install dependencies
pnpm install

# 2. Copy env template and fill in values
cp .env.example .env
# DATABASE_URL, REDIS_URL, POSTGRES_USER/PASSWORD/DB, BLOB_PATH,
# OPENAI_API_KEY, WORKER_CONCURRENCY, QDRANT_URL/API_KEY/COLLECTION, API_PORT

# 3. Start Postgres + Redis
docker compose up -d

# 4. Run migrations
pnpm --filter @crawler/db exec prisma migrate deploy

# 5. (optional) seed a demo user + job
pnpm --filter @crawler/db run seed

# 6. Start the API
pnpm --filter @crawler/api run dev
```

The worker pool is started by the API on job creation (`POST /api/jobs`), or directly via `pnpm --filter @crawler/worker run dev` (runs the `run.ts` fixture, which spins up 3 concurrent verification jobs).

## API

All routes except `/health` require an `x-api-key` header matching a `User.apiKey`.

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/jobs` | Create a job (seed URLs, depth, maxPages, component config). Returns `202` with `jobId` and starts crawling in the background. |
| `GET` | `/api/jobs/:id` | Job status, config, and `JobStat` counters. |
| `GET` | `/api/jobs/:id/results` | Export all `DerivedResult` rows for the job as JSON. |
| `POST` | `/api/jobs/:id/vectors` | Push `semantic`-parser results (with embeddings) to Qdrant. Creates the collection (1536-dim, cosine) if it doesn't exist. |

**Example job creation:**

```json
POST /api/jobs
{
  "seedUrls": ["https://example.com"],
  "depth": 2,
  "maxPages": 20,
  "config": {
    "fetcher": "http",
    "parser": "focused",
    "strategy": "focused",
    "politeness": "standard",
    "revisit": "none",
    "strategyConfig": { "topics": ["machine learning"], "threshold": 0.3 }
  }
}
```

## Known limitations

- **robots.txt is not enforced.** `StandardPoliteness` only rate-limits per domain; there's no fetch/parse/cache of `robots.txt` yet.
- **Raw HTML isn't persisted to a blob store.** `RawPage.blobUrl` currently stores a derived string reference, but the worker never writes the fetched HTML anywhere durable — only parsed/derived text survives.
- **Semantic parser output (embeddings, entities) isn't saved to `DerivedResult`.** Only `title`/`cleanText`/`metadata`/`wordCount` are persisted, so `POST /api/jobs/:id/vectors` currently finds nothing to push. This is the next fix needed before semantic mode works end-to-end.
- **Revisit is a stub.** No time-based or change-detection re-crawling exists yet.
- Only one implementation each for politeness and revisit, and two each for fetcher/parser/strategy — the registry supports more, they just aren't written yet.

## Roadmap

- [ ] Persist embeddings/entities from `SemanticParser` into `DerivedResult`
- [ ] Actual blob storage for raw HTML (local disk now, S3/R2 later)
- [ ] robots.txt compliance in `StandardPoliteness`
- [ ] Additional components: `gentle`/`aggressive`/`custom` politeness, `time-based`/`change-detection` revisit, `domain`/`semantic` strategies
- [ ] More API routes: list jobs, pause/resume, delete, live stats, config validation
- [ ] Extract `@crawlkit/core` as a standalone published npm package
- [ ] YAML/JSON config file support + `crawlkit` CLI (`run`, `validate`, `init`, `status`, `export`)
- [ ] Programmatic `Crawler` class with an event-driven API (`crawler.on('page', ...)`)

## License

ISC 
