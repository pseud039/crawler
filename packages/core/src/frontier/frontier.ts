import redis from './redis.js';
import { db } from '@crawler/db/src/prisma.js';
import { FrontierUrlStatus } from '@prisma/client';

const LEASE_TTL_MS = 60_000; // 60s lease

function keys(jobId: string) {
  return {
    queue:  `frontier:job:${jobId}:queue`,
    leased: `frontier:job:${jobId}:leased`,
    seen:   `frontier:job:${jobId}:seen`,
  };
}

// Seed Redis from an array of URLs (called once when job starts)
export async function seedFrontier(jobId: string, urls: string[]) {
  const k = keys(jobId);
  const pipeline = redis.pipeline();
  for (const url of urls) {
    pipeline.zadd(k.queue, 0, url);   // priority 0 = highest (ZPOPMIN pops lowest score)
    pipeline.sadd(k.seen, url);
  }
  await pipeline.exec();
}

// Atomic: pop lowest-score URL from queue → add to leased ZSET
export async function acquireUrl(jobId: string): Promise<string | null> {
  const k = keys(jobId);
  const leaseExpiry = Date.now() + LEASE_TTL_MS;

  const result = await redis.eval(
    `local item = redis.call("ZPOPMIN", KEYS[1], 1)
     if #item == 0 then return nil end
     redis.call("ZADD", KEYS[2], ARGV[1], item[1])
     return item[1]`,
    2,
    k.queue,
    k.leased,
    leaseExpiry
  ) as string | null;

  return result ?? null;
}

// Push newly discovered URLs into the frontier (skip already-seen)
export async function pushUrls(
  jobId: string,
  urls: Array<{ url: string; priority: number; depth: number }>  // add depth
) {
  const k = keys(jobId);

  // Deduplicate incoming URLs by url, keeping the highest priority (lowest number)
  const map = new Map<string, { url: string; priority: number; depth: number }>();
  for (const u of urls) {
    const existing = map.get(u.url);
    if (!existing || u.priority < existing.priority) map.set(u.url, u);
  }
  const unique = Array.from(map.values());

  // Exclude already-seen URLs
  const seenSet = new Set(await redis.smembers(k.seen));
  const newUrls = unique.filter(u => !seenSet.has(u.url));

  if (newUrls.length === 0) return;

  const pipeline = redis.pipeline();
  for (const { url, priority } of newUrls) {
    pipeline.zadd(k.queue, 1 - priority, url);
    pipeline.sadd(k.seen, url);
  }
  await pipeline.exec();

  await db.frontierUrl.createMany({
    data: newUrls.map(({ url, priority, depth }) => ({
      jobId,
      url,
      priority,
      depth,
      status: FrontierUrlStatus.queued,
      retryCount: 0,
    })),
    skipDuplicates: true,
  });
}

// Release URL after processing
export async function releaseUrl(
  jobId: string,
  url: string,
  success: boolean
) {
  const k = keys(jobId);
  await redis.zrem(k.leased, url);

  if (success) {
    await redis.sadd(k.seen, url);
    await db.frontierUrl.updateMany({
      where: { jobId, url },
      data: { status: FrontierUrlStatus.crawled, crawledAt: new Date() },
    });
  } else {
    // Requeue with delay penalty (30s from now as score)
    await redis.zadd(k.queue, Date.now() + 30_000, url);
    await db.frontierUrl.updateMany({
      where: { jobId, url },
      data: { retryCount: { increment: 1 } },
    });
  }
}

// Recover expired leases — run on a setInterval every 30s
export async function recoverExpiredLeases(jobId: string) {
  const k = keys(jobId);
  const expired = await redis.zrangebyscore(k.leased, 0, Date.now());
  if (expired.length === 0) return;

  const pipeline = redis.pipeline();
  for (const url of expired) {
    pipeline.zrem(k.leased, url);
    pipeline.zadd(k.queue, Date.now(), url);
  }
  await pipeline.exec();
  console.log(`[frontier] recovered ${expired.length} expired leases for job ${jobId}`);
}

// Rebuild Redis from Postgres if Redis is empty (e.g. after restart)
export async function rebuildFrontier(jobId: string) {
  const k = keys(jobId);
  const queueSize = await redis.zcard(k.queue);
  if (queueSize > 0) return; // already populated

  const pending = await db.frontierUrl.findMany({
    where: { jobId, status: { in: [FrontierUrlStatus.queued, FrontierUrlStatus.leased] } },
    select: { url: true, priority: true },
  });

  if (pending.length === 0) return;

  const pipeline = redis.pipeline();
  for (const { url, priority } of pending) {
    pipeline.zadd(k.queue, 1 - priority, url);
    pipeline.sadd(k.seen, url);
  }
  await pipeline.exec();
  console.log(`[frontier] rebuilt from Postgres — ${pending.length} URLs loaded`);
}

export async function getFrontierSize(jobId: string) {
  const k = keys(jobId);
  return redis.zcard(k.queue);
}