import type { PolitenessComponent } from '../../interfaces/politeness.interface.js';
import redis from '../../frontier/redis.js';

export class StandardPoliteness implements PolitenessComponent {
  name = 'standard';
  type = 'politeness' as const;

  private delayMs = 2000;
  private respectRobots = true;

  async init(config: Record<string, any>): Promise<void> {
    if (config.delayMs) this.delayMs = config.delayMs;
    if (config.respectRobots !== undefined) this.respectRobots = config.respectRobots;
  }

  private extractDomain(domain: string): string {
    try { return new URL(domain).hostname; } catch { return domain; }
  }

  async shouldCrawl(domain: string): Promise<boolean> {
    const host = this.extractDomain(domain);
    const key = `domain:rate:${host}`;
    const last = await redis.get(key);
    if (!last) return true;
    return Date.now() - parseInt(last) >= this.delayMs;
  }

  async getDelay(domain: string): Promise<number> {
    const host = this.extractDomain(domain);
    const key = `domain:rate:${host}`;
    const last = await redis.get(key);
    if (!last) return 0;
    const elapsed = Date.now() - parseInt(last);
    return Math.max(0, this.delayMs - elapsed);
  }

  async onCrawled(domain: string): Promise<void> {
    const host = this.extractDomain(domain);
    const key = `domain:rate:${host}`;
    // TTL = 2x delay so key auto-expires if domain goes idle
    await redis.set(key, Date.now().toString(), 'EX', Math.ceil((this.delayMs * 2) / 1000));
  }
}