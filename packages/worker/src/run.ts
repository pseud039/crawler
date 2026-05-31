import { runWorker } from './worker.js';
import { db } from '@crawler/db/src/prisma.js';

async function main() {
  // 1. Create a minimal job row
  const job = await db.crawlJob.create({
    data: {
      user_id: 'YOUR_TEST_USER_UUID',  // seed a users row first
      name: 'M1 smoke test',
      status: 'pending',
      config: { fetcher: 'http', parser: 'readability', strategy: 'bfs' },
      seed_urls: ['https://example.com'],
      depth: 1,
      max_pages: 5,
    }
  });

  console.log('Job created:', job.id);
  await runWorker(job.id);

  // 2. Verify
  const results = await db.derived_results.findMany({ where: { job_id: job.id } });
  console.log(`derived_results rows: ${results.length}`);
  console.log(JSON.stringify(results[0]?.derived_data, null, 2));
}

main().catch(console.error).finally(() => db.$disconnect());