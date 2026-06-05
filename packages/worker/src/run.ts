import { runWorker } from './worker.js';
import { db, CrawlJobStatus, UserPlan } from '@crawler/db/src/prisma.js';

async function main() {
  // Ensure a user exists (seed inline for the smoke test)
  const user = await db.user.upsert({
    where: { email: 'demo@nexusseo.com' },
    update: {},
    create: {
      email: 'demo@nexusseo.com',
      apiKey: 'demo-api-key',
      plan: UserPlan.free,
    },
  });

  // 1. Create a minimal job row
  const job = await db.crawlJob.create({
    data: {
      userId: user.id,
      name: 'M1 smoke test',
      status: CrawlJobStatus.pending,
      config: { fetcher: 'http', parser: 'readability', strategy: 'bfs' },
      seedUrls: ['https://example.com'],
      depth: 1,
      maxPages: 5,
    },
  });

  console.log('Job created:', job.id);
  await runWorker(job.id);

  // 2. Verify
  const results = await db.derivedResult.findMany({ where: { jobId: job.id } });
  console.log(`derived_results rows: ${results.length}`);
  console.log(JSON.stringify(results[0]?.derivedData, null, 2));
}

main().catch(console.error).finally(() => db.$disconnect());