// packages/worker/src/worker.ts
import { db } from "@crawler/db/src/prisma.js";
import { HttpFetcher } from "@crawler/core/src/components/fetchers/http.fetcher.js";
import { ReadabilityParser } from "@crawler/core/src/components/parsers/readability.js";
import { BfsStrategy } from '@crawler/core/src/components/strategies/bfs.strategies.js';
import { FrontierUrlStatus, CrawlJobStatus } from '@crawler/db/prisma/migrations/20260530215904_db_setup/migration';
import crypto from 'crypto';

async function processUrl(jobId: string, urlRow: { id: number; url: string; depth: number }) {
  const fetcher = new HttpFetcher();
  const parser = new ReadabilityParser();
  const strategy = new BfsStrategy();

  // 1. Fetch
  const fetchResult = await fetcher.fetch(urlRow.url);
  if (fetchResult.error || fetchResult.statusCode >= 400) {
    await db.frontierUrl.update({
      where: { id: urlRow.id },
      data: { status: FrontierUrlStatus.failed, crawledAt: new Date() }
    });
    return;
  }

  // 2. Store raw_page (deduped by content_hash)
  const hash = crypto.createHash('sha256').update(fetchResult.html).digest('hex');
  let rawPage = await db.rawPage.findFirst({ where: { contentHash: hash } });

  if (!rawPage) {
    rawPage = await db.rawPage.create({
      data: {
        url: urlRow.url,
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
  const parseResult = await parser.parse(fetchResult.html, urlRow.url);

  // 4. Get job config for depth limit
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

  // 6. BFS: select + push discovered links (if depth allows)
  if (urlRow.depth < job.depth) {
    const scoredUrls = await strategy.selectLinks(parseResult.links, parseResult, job.config as any);

    await db.frontierUrl.createMany({
      data: scoredUrls.map(({ url }) => ({
        jobId,
        url,
        depth: urlRow.depth + 1,
        status: FrontierUrlStatus.queued,
      })),
      skipDuplicates: true,
    });
  }

  // 7. Mark as crawled + update stats
  await db.frontierUrl.update({
    where: { id: urlRow.id },
    data: { status: FrontierUrlStatus.crawled, crawledAt: new Date() }
  });

  await db.jobStat.update({
    where: { jobId },
    data: {
      urlsCrawled: { increment: 1 },
      bytesFetched: { increment: rawPage.byteSize ?? 0 },
      updatedAt: new Date(),
    }
  });
}

export async function runWorker(jobId: string) {
  console.log(`[worker] starting for job ${jobId}`);

  const job = await db.crawlJob.findUniqueOrThrow({ where: { id: jobId } });

  // Seed frontier if empty
  const frontierCount = await db.frontierUrl.count({ where: { jobId } });
  if (frontierCount === 0) {
    await db.frontierUrl.createMany({
      data: job.seedUrls.map(url => ({
        jobId,
        url,
        depth: 0,
        status: FrontierUrlStatus.queued,
      }))
    });
  }

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

  // Main loop
  while (true) {
    const urlRow = await db.frontierUrl.findFirst({
      where: { jobId, status: FrontierUrlStatus.queued },
      orderBy: { addedAt: 'asc' }
    });

    if (!urlRow) {
      console.log(`[worker] frontier empty — job ${jobId} done`);
      await db.crawlJob.update({
        where: { id: jobId },
        data: { status: CrawlJobStatus.done, finishedAt: new Date() }
      });
      break;
    }

    // Lease it
    await db.frontierUrl.update({
      where: { id: urlRow.id },
      data: { status: FrontierUrlStatus.leased }
    });

    try {
      await processUrl(jobId, urlRow);
    } catch (err) {
      console.error(`[worker] error on ${urlRow.url}:`, err);
      await db.frontierUrl.update({
        where: { id: urlRow.id },
        data: {
          status: FrontierUrlStatus.failed,
          crawledAt: new Date(),
          retryCount: { increment: 1 },
        }
      });
      await db.jobStat.update({
        where: { jobId },
        data: { urlsFailed: { increment: 1 }, updatedAt: new Date() }
      });
    }
  }
}