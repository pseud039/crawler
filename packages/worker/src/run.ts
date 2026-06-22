import { db, CrawlJobStatus, UserPlan } from '@crawler/db/src/prisma.js';
import { JobScheduler } from './scheduler.js';
import { runPool } from './pool.js';

async function main() {
  // Ensure user exists
  const user = await db.user.upsert({
    where: { email: 'demo@nexusseo.com' },
    update: {},
    create: {
      email: 'demo@nexusseo.com',
      apiKey: 'demo-api-key',
      plan: UserPlan.free,
    },
  });

  // Create 3 simultaneous jobs — M4 verify target
  const jobConfigs = [
    {
      name: 'M4 job 1 — example.com',
      seedUrls: ['https://example.com'],
      config: {
        fetcher: 'http', parser: 'readability',
        strategy: 'bfs', politeness: 'standard', revisit: 'none',
        politenessConfig: { delayMs: 500 },
      },
    },
    {
      name: 'M4 job 2 — iana.org',
      seedUrls: ['https://www.iana.org'],
      config: {
        fetcher: 'http', parser: 'readability',
        strategy: 'focused', politeness: 'standard', revisit: 'none',
        strategyConfig: { topics: ['domain', 'internet', 'protocol'], threshold: 0.1 },
        politenessConfig: { delayMs: 500 },
      },
    },
    {
      name: 'M4 job 3 — wikipedia simple',
      seedUrls: ['https://simple.wikipedia.org/wiki/Main_Page'],
      config: {
        fetcher: 'http', parser: 'readability',
        strategy: 'bfs', politeness: 'standard', revisit: 'none',
        politenessConfig: { delayMs: 1000 },
      },
    },
  ];

  const jobs = await Promise.all(
    jobConfigs.map(cfg =>
      db.crawlJob.create({
        data: {
          userId: user.id,
          name: cfg.name,
          status: CrawlJobStatus.pending,
          config: cfg.config,
          seedUrls: cfg.seedUrls,
          depth: 1,
          maxPages: 10,
        },
      })
    )
  );

  console.log('Jobs created:', jobs.map(j => j.id));

  // Boot scheduler + pool
  const scheduler = new JobScheduler();
  await scheduler.init();
  await runPool(scheduler);

  // Verify — no cross-contamination means each job only has its own results
  for (const job of jobs) {
    const count = await db.derivedResult.count({ where: { jobId: job.id } });
    console.log(`[verify] ${job.name}: ${count} derived_results`);
  }
}

main().catch(console.error).finally(() => db.$disconnect());