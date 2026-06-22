import { db } from '@crawler/db/src/prisma.js';
import { CrawlJobStatus } from '@crawler/db/src/prisma.js';
import { seedFrontier, getFrontierSize, rebuildFrontier } from '@crawler/core/src/frontier/frontier.js';

export class JobScheduler {
  private jobIds: string[] = [];
  private pointer = 0;

  // Load all pending/running jobs from Postgres into round-robin queue
  async init(): Promise<void> {
    const jobs = await db.crawlJob.findMany({
      where: { status: { in: [CrawlJobStatus.pending, CrawlJobStatus.running] } },
      select: { id: true, seedUrls: true, status: true },
    });

    for (const job of jobs) {
      // Seed Redis if pending, rebuild if running but Redis is empty (restart case)
      if (job.status === CrawlJobStatus.pending) {
        await seedFrontier(job.id, job.seedUrls);
        await db.crawlJob.update({
          where: { id: job.id },
          data: { status: CrawlJobStatus.running, startedAt: new Date() },
        });
      } else {
        await rebuildFrontier(job.id);
      }

      this.jobIds.push(job.id);
    }

    console.log(`[scheduler] loaded ${this.jobIds.length} jobs`);
  }

  // Register a newly created job into the scheduler at runtime
  async addJob(jobId: string, seedUrls: string[]): Promise<void> {
    await seedFrontier(jobId, seedUrls);
    await db.crawlJob.update({
      where: { id: jobId },
      data: { status: CrawlJobStatus.running, startedAt: new Date() },
    });
    this.jobIds.push(jobId);
    console.log(`[scheduler] added job ${jobId}`);
  }

  // Round-robin: return next jobId that still has work, skip exhausted ones
  async nextJob(): Promise<string | null> {
    if (this.jobIds.length === 0) return null;

    const total = this.jobIds.length;
    let checked = 0;

    while (checked < total) {
      const jobId = this.jobIds[this.pointer % this.jobIds.length]!;
      this.pointer = (this.pointer + 1) % this.jobIds.length;
      checked++;

      const size = await getFrontierSize(jobId);
      if (!jobId) {
  return null;
}
      if (size > 0) return jobId;
    }

    return null; // all frontiers empty
  }

  // Remove a finished job from rotation
  async finishJob(jobId: string): Promise<void> {
    this.jobIds = this.jobIds.filter(id => id !== jobId);
    if (this.pointer >= this.jobIds.length) {
      this.pointer = 0;
    }
    await db.crawlJob.update({
      where: { id: jobId },
      data: { status: CrawlJobStatus.done, finishedAt: new Date() },
    });
    console.log(`[scheduler] job ${jobId} finished — ${this.jobIds.length} remaining`);
  }

  get activeJobCount(): number {
    return this.jobIds.length;
  }
}