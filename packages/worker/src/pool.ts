import { db } from '@crawler/db/src/prisma.js';
import { FrontierUrlStatus } from '@crawler/db/src/prisma.js';
import { acquireUrl, releaseUrl, pushUrls, recoverExpiredLeases } from '@crawler/core/src/frontier/frontier.js';
import { loadComponents } from '@crawler/core/src/registry.js';
import { JobScheduler } from './scheduler.js';
import crypto from 'crypto';

const WORKER_COUNT = parseInt(process.env.WORKER_CONCURRENCY ?? '5');

async function processUrl(
  jobId: string,
  url: string,
  depth: number,
  components: Awaited<ReturnType<typeof loadComponents>>
): Promise<void> {
  const { fetcher, parser, strategy, politeness } = components;

  // Politeness check
  const delay = await politeness.getDelay(url);
  if (delay > 0) await new Promise(r => setTimeout(r, delay));
  const shouldCrawl = await politeness.shouldCrawl(url);
  if (!shouldCrawl) {
    await releaseUrl(jobId, url, true); // skip but mark done
    return;
  }

  const fetchResult = await fetcher.fetch(url);
  await politeness.onCrawled(url);

  if (fetchResult.error || fetchResult.statusCode >= 400) {
    await releaseUrl(jobId, url, false);
    await db.jobStat.update({
      where: { jobId },
      data: { urlsFailed: { increment: 1 }, updatedAt: new Date() },
    });
    return;
  }

  // Dedup by content hash
  const hash = crypto.createHash('sha256').update(fetchResult.html).digest('hex');
  let rawPage = await db.rawPage.findFirst({ where: { contentHash: hash } });

  if (!rawPage) {
    rawPage = await db.rawPage.create({
      data: {
        url,
        contentHash: hash,
        blobUrl: `local://${hash}.html`,
        httpStatus: fetchResult.statusCode,
        headers: fetchResult.headers as any,
        fetchedAt: fetchResult.fetchedAt,
        byteSize: Buffer.byteLength(fetchResult.html),
      },
    });
  }

  const parseResult = await parser.parse(fetchResult.html, url);
  const job = await db.crawlJob.findUniqueOrThrow({ where: { id: jobId } });

  await db.derivedResult.create({
    data: {
      jobId,
      rawPageId: rawPage.id,
      componentType: components.parser.name,
      derivedData: {
        title: parseResult.title,
        cleanText: parseResult.cleanText,
        metadata: parseResult.metadata,
        wordCount: parseResult.cleanText.split(/\s+/).length,
      },
    },
  });

  await db.jobStat.update({
    where: { jobId },
    data: {
      urlsCrawled: { increment: 1 },
      bytesFetched: { increment: rawPage.byteSize ?? 0 },
      updatedAt: new Date(),
    },
  });

  // Link discovery
  if (depth < job.depth) {
    const scoredUrls = await strategy.selectLinks(
      parseResult.links,
      parseResult,
      job.config as any
    );
    if (scoredUrls.length > 0) {
      await pushUrls(jobId, scoredUrls.map(u => ({
        url: u.url,
        priority: u.priority,
        depth: depth + 1,
      })));
    }
  }

  await releaseUrl(jobId, url, true);
}

// Single worker loop — runs until scheduler has no more work
async function workerLoop(
  workerId: number,
  scheduler: JobScheduler,
  componentCache: Map<string, Awaited<ReturnType<typeof loadComponents>>>
): Promise<void> {
  console.log(`[worker:${workerId}] started`);

  while (true) {
    const jobId = await scheduler.nextJob();

    if (!jobId) {
      // No work right now — wait briefly and retry
      await new Promise(r => setTimeout(r, 500));

      // If scheduler has no active jobs at all, exit
      if (scheduler.activeJobCount === 0) {
        console.log(`[worker:${workerId}] no jobs remaining — exiting`);
        break;
      }
      continue;
    }

    const url = await acquireUrl(jobId);
    if (!url) continue; // another worker grabbed it, try next round

    // Load components per-job (cached)
    if (!componentCache.has(jobId)) {
      const job = await db.crawlJob.findUniqueOrThrow({ where: { id: jobId } });
      const components = await loadComponents({
        fetcher:          (job.config as any).fetcher    ?? 'http',
        parser:           (job.config as any).parser     ?? 'readability',
        strategy:         (job.config as any).strategy   ?? 'bfs',
        politeness:       (job.config as any).politeness ?? 'standard',
        revisit:          (job.config as any).revisit    ?? 'none',
        strategyConfig:   (job.config as any).strategyConfig,
        politenessConfig: (job.config as any).politenessConfig,
      });
      componentCache.set(jobId, components);
    }

    const components = componentCache.get(jobId)!;

    // Get depth from Postgres frontier row
    const frontierRow = await db.frontierUrl.findFirst({
      where: { jobId, url, status: FrontierUrlStatus.leased },
      select: { depth: true },
    });
    const depth = frontierRow?.depth ?? 0;

    try {
      await processUrl(jobId, url, depth, components);
    } catch (err) {
      console.error(`[worker:${workerId}] error on ${url}:`, err);
      await releaseUrl(jobId, url, false);
      await db.jobStat.update({
        where: { jobId },
        data: { urlsFailed: { increment: 1 }, updatedAt: new Date() },
      });
    }

    // Check if this job's frontier is now empty — finish it
    const remaining = await scheduler.nextJob();
    if (remaining === null && scheduler.activeJobCount > 0) {
      // check specifically this job
      const { getFrontierSize } = await import('@crawler/core/src/frontier/frontier.js');
      const size = await getFrontierSize(jobId);
      if (size === 0) {
        await scheduler.finishJob(jobId);
      }
    }
  }
}

export async function runPool(scheduler: JobScheduler): Promise<void> {
  // Init job_stats for all active jobs
  for (const jobId of (scheduler as any).jobIds as string[]) {
    await db.jobStat.upsert({
      where: { jobId },
      create: { jobId },
      update: {},
    });
  }

  // Shared component cache — one set of components per job, shared across workers
  const componentCache = new Map<string, Awaited<ReturnType<typeof loadComponents>>>();

  // Lease recovery — runs every 30s globally
  const recovery = setInterval(async () => {
    for (const jobId of (scheduler as any).jobIds as string[]) {
      await recoverExpiredLeases(jobId);
    }
  }, 30_000);

  // Spawn N workers in parallel
  const workers = Array.from({ length: WORKER_COUNT }, (_, i) =>
    workerLoop(i + 1, scheduler, componentCache)
  );

  await Promise.all(workers);
  clearInterval(recovery);

  console.log('[pool] all workers done');
}