import { runWorker } from './worker.js';
import { db, CrawlJobStatus, UserPlan } from '@crawler/db/src/prisma.js';

async function main() {
  // Ensure a user exists
  const user = await db.user.upsert({
    where: { email: 'demo@nexusseo.com' },
    update: {},
    create: {
      email: 'demo@nexusseo.com',
      apiKey: 'demo-api-key',
      plan: UserPlan.free,
    },
  });

  // Create job with full M3 component config
  const job = await db.crawlJob.create({
    data: {
      userId: user.id,
      name: 'M3 smoke test',
      status: CrawlJobStatus.pending,
      config: {
        fetcher: 'http',
        parser: 'readability',
        strategy: 'focused',
        politeness: 'standard',
        revisit: 'none',
        strategyConfig: {
          topics: ['example', 'domain', 'documentation'],
          threshold: 0.1,
          maxLinks: 50,
        },
        politenessConfig: {
          delayMs: 1000,
          respectRobots: false,
        },
      },
      seedUrls: ['https://example.com'],
      depth: 2,
      maxPages: 20,
    },
  });

  console.log('Job created:', job.id);
  await runWorker(job.id);

  // Verify
  const results = await db.derivedResult.findMany({ where: { jobId: job.id } });
  console.log(`derived_results rows: ${results.length}`);
  console.log(JSON.stringify(results[0]?.derivedData, null, 2));
}

main().catch(console.error).finally(() => db.$disconnect());