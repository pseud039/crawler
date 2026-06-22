// packages/worker/src/worker.ts
import { db } from "@crawler/db/src/prisma.js";
import { HttpFetcher } from "@crawler/core/src/components/fetchers/http.fetcher.js";
import { ReadabilityParser } from "@crawler/core/src/components/parsers/readability.js";
import { BfsStrategy } from '@crawler/core/src/components/strategies/bfs.strategies.js';
import { CrawlJobStatus, FrontierUrlStatus } from '@crawler/db/src/prisma.js';
import type { LoadedComponents } from '@crawler/core/src/registry.js';
import { loadComponents } from '@crawler/core/src/registry.js';
import crypto from 'crypto';
import {
  seedFrontier,
  acquireUrl,
  releaseUrl,
  pushUrls,
  recoverExpiredLeases,
} from '@crawler/core/src/frontier/frontier.js';

// Now returns ScoredUrl[] so the worker loop can push to Redis
async function processUrl(jobId: string, url: string, depth: number,components: LoadedComponents) {
    const { fetcher, parser, strategy, politeness } = components;

  // politeness check before fetch
  const delay = await politeness.getDelay(url);
  if (delay > 0) await new Promise(r => setTimeout(r, delay));

  const shouldCrawl = await politeness.shouldCrawl(url);
  if (!shouldCrawl) return [];

  const fetchResult = await fetcher.fetch(url);
  await politeness.onCrawled(url);


  // // 1. Fetch
  // const fetchResult = await fetcher.fetch(url);
  // if (fetchResult.error || fetchResult.statusCode >= 400) {
  //   return [];  // signal failure — releaseUrl(false) handled in caller
  // }

  // 2. Store raw_page (deduped by content_hash)
  const hash = crypto.createHash('sha256').update(fetchResult.html).digest('hex');
  let rawPage = await db.rawPage.findFirst({ where: { contentHash: hash } });

  if (!rawPage) {
    rawPage = await db.rawPage.create({
      data: {
        url,
        contentHash: hash,
        blobUrl: `pages/${hash}.html`,
        httpStatus: fetchResult.statusCode,
        headers: fetchResult.headers as any,
        fetchedAt: fetchResult.fetchedAt,
        byteSize: Buffer.byteLength(fetchResult.html),
      }
    });
  }

  // 3. Parse
  const parseResult = await parser.parse(fetchResult.html, url);

  // 4. Get job config for depth check
  const job = await db.crawlJob.findUniqueOrThrow({ where: { id: jobId } });

  // 5. Store derived_result
  await db.derivedResult.create({
    data: {
      jobId,
      rawPageId: rawPage.id,
      componentType: 'readability',
      derivedData: {
        title: parseResult.title,
        cleanText: parseResult.cleanText,
        metadata: parseResult.metadata,
        wordCount: parseResult.cleanText.split(/\s+/).length,
      }
    }
  });

  // 6. Update stats
  await db.jobStat.update({
    where: { jobId },
    data: {
      urlsCrawled: { increment: 1 },
      bytesFetched: { increment: rawPage.byteSize ?? 0 },
      updatedAt: new Date(),
    }
  });

  // 7. Return scored links if depth allows — worker loop pushes to Redis
  if (depth < job.depth) {
    return strategy.selectLinks(parseResult.links, parseResult, job.config as any);
  }
  return [];
}

export async function runWorker(jobId: string) {
  console.log(`[worker] starting for job ${jobId}`);

  const job = await db.crawlJob.findUniqueOrThrow({ where: { id: jobId } });
 // Load components from job config
  const components = await loadComponents({
    fetcher:    (job.config as any).fetcher    ?? 'http',
    parser:     (job.config as any).parser     ?? 'readability',
    strategy:   (job.config as any).strategy   ?? 'bfs',
    politeness: (job.config as any).politeness ?? 'standard',
    revisit:    (job.config as any).revisit    ?? 'none',
    strategyConfig:   (job.config as any).strategyConfig,
    politenessConfig: (job.config as any).politenessConfig,
  });
  // Seed Redis frontier from job's seedUrls
  await seedFrontier(jobId, job.seedUrls);

  // Init job_stats row if missing
  await db.jobStat.upsert({
    where: { jobId },
    create: { jobId },
    update: {},
  });

  // Mark job as running
  await db.crawlJob.update({
    where: { id: jobId },
    data: { status: CrawlJobStatus.running, startedAt: new Date() }
  });

  // Lease recovery every 30s
  const recovery = setInterval(() => recoverExpiredLeases(jobId), 30_000);

  try {
    while (true) {
      const url = await acquireUrl(jobId);

      if (!url) {
        console.log(`[worker] frontier empty — job ${jobId} done`);
        break;
      }

      // depth tracking: read from Postgres frontier row
      const frontierRow = await db.frontierUrl.findFirst({
        where: { jobId, url, status: FrontierUrlStatus.leased },
        select: { depth: true },
      });
      const depth = frontierRow?.depth ?? 0;

      try {
        const scoredUrls = await processUrl(jobId, url, depth, components);

        // Push discovered links into Redis + Postgres
        if (scoredUrls.length > 0) {
          await pushUrls(jobId, scoredUrls.map(u => ({
            url: u.url,
            priority: u.priority,
            depth: depth + 1,
          })));
        }

        await releaseUrl(jobId, url, true);
      } catch (err) {
        console.error(`[worker] error on ${url}:`, err);
        await db.jobStat.update({
          where: { jobId },
          data: { urlsFailed: { increment: 1 }, updatedAt: new Date() }
        });
        await releaseUrl(jobId, url, false);
      }
    }
  } finally {
    clearInterval(recovery);
    await db.crawlJob.update({
      where: { id: jobId },
      data: { status: CrawlJobStatus.done, finishedAt: new Date() }
    });
  }
}