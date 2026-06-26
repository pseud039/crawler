import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db, CrawlJobStatus, UserPlan } from '@crawler/db/src/prisma.js';
import { JobScheduler } from '@crawler/worker/src/scheduler.js';
import { runPool } from '@crawler/worker/src/pool.js';
import { pushVector, ensureCollection } from '../qdrant.js';

const CreateJobSchema = z.object({
  seedUrls: z.array(z.string().url()).min(1),
  depth: z.number().int().min(1).max(5).default(2),
  maxPages: z.number().int().min(1).max(100).default(20),
  config: z.object({
    fetcher:    z.enum(['http', 'headless']).default('http'),
    parser:     z.enum(['readability', 'semantic']).default('readability'),
    strategy:   z.enum(['bfs', 'focused']).default('bfs'),
    politeness: z.enum(['standard']).default('standard'),
    revisit:    z.enum(['none']).default('none'),
    strategyConfig:   z.record(z.any()).optional(),
    politenessConfig: z.record(z.any()).optional(),
  }).default({}),
});

export async function jobRoutes(app: FastifyInstance) {
  // POST /api/jobs — create job + seed frontier + run pool
  app.post('/api/jobs', async (req, reply) => {
    const apiKey = req.headers['x-api-key'] as string;
    if (!apiKey) return reply.status(401).send({ error: 'Missing x-api-key header' });

    const user = await db.user.findFirst({ where: { apiKey } });
    if (!user) return reply.status(403).send({ error: 'Invalid API key' });

    const body = CreateJobSchema.safeParse(req.body);
    if (!body.success) {
      return reply.status(400).send({ error: body.error.flatten() });
    }

    const { seedUrls, depth, maxPages, config } = body.data;

    const job = await db.crawlJob.create({
      data: {
        userId: user.id,
        name: `API job — ${seedUrls[0]}`,
        status: CrawlJobStatus.pending,
        config,
        seedUrls,
        depth,
        maxPages,
      },
    });

    // Run pool in background — don't await, return job id immediately
    const scheduler = new JobScheduler();
    await scheduler.init();
    runPool(scheduler).catch(err =>
      console.error(`[pool] job ${job.id} failed:`, err)
    );

    return reply.status(202).send({
      jobId: job.id,
      status: 'accepted',
      message: 'Job created and crawl started',
    });
  });

  // GET /api/jobs/:id — job status
  app.get('/api/jobs/:id', async (req, reply) => {
    const apiKey = req.headers['x-api-key'] as string;
    if (!apiKey) return reply.status(401).send({ error: 'Missing x-api-key header' });

    const user = await db.user.findFirst({ where: { apiKey } });
    if (!user) return reply.status(403).send({ error: 'Invalid API key' });

    const { id } = req.params as { id: string };
    const job = await db.crawlJob.findFirst({
      where: { id, userId: user.id },
      include: { jobStats: true },
    });

    if (!job) return reply.status(404).send({ error: 'Job not found' });

    return reply.send({
      id: job.id,
      name: job.name,
      status: job.status,
      seedUrls: job.seedUrls,
      depth: job.depth,
      maxPages: job.maxPages,
      stats: job.jobStats,
      createdAt: job.createdAt,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
    });
  });

  // GET /api/jobs/:id/results — export derived results as JSON
  app.get('/api/jobs/:id/results', async (req, reply) => {
    const apiKey = req.headers['x-api-key'] as string;
    if (!apiKey) return reply.status(401).send({ error: 'Missing x-api-key header' });

    const user = await db.user.findFirst({ where: { apiKey } });
    if (!user) return reply.status(403).send({ error: 'Invalid API key' });

    const { id } = req.params as { id: string };
    const job = await db.crawlJob.findFirst({
      where: { id, userId: user.id },
    });
    if (!job) return reply.status(404).send({ error: 'Job not found' });

    const results = await db.derivedResult.findMany({
      where: { jobId: id },
      include: { rawPage: { select: { url: true, httpStatus: true, fetchedAt: true } } },
      orderBy: { createdAt: 'asc' },
    });

    return reply.send({
      jobId: id,
      total: results.length,
      results: results.map(r => ({
        id: r.id,
        url: r.rawPage.url,
        httpStatus: r.rawPage.httpStatus,
        fetchedAt: r.rawPage.fetchedAt,
        componentType: r.componentType,
        data: r.derivedData,
        createdAt: r.createdAt,
      })),
    });
  });

  // POST /api/jobs/:id/vectors — push semantic results to Qdrant
  app.post('/api/jobs/:id/vectors', async (req, reply) => {
    const apiKey = req.headers['x-api-key'] as string;
    if (!apiKey) return reply.status(401).send({ error: 'Missing x-api-key header' });

    const user = await db.user.findFirst({ where: { apiKey } });
    if (!user) return reply.status(403).send({ error: 'Invalid API key' });

    const { id } = req.params as { id: string };
    const job = await db.crawlJob.findFirst({ where: { id, userId: user.id } });
    if (!job) return reply.status(404).send({ error: 'Job not found' });

    // Only semantic parser results have embeddings
    const results = await db.derivedResult.findMany({
      where: { jobId: id, componentType: 'semantic' },
      include: { rawPage: { select: { url: true } } },
    });

    if (results.length === 0) {
      return reply.status(400).send({
        error: 'No semantic results found — rerun job with parser: semantic',
      });
    }

    await ensureCollection();

    let pushed = 0;
    for (const result of results) {
      const data = result.derivedData as any;
      if (!data.embedding) continue;

      await pushVector(result.id, data.embedding, {
        jobId: id,
        url: result.rawPage.url,
        title: data.title,
        wordCount: data.wordCount,
      });
      pushed++;
    }

    return reply.send({ pushed, total: results.length });
  });
}