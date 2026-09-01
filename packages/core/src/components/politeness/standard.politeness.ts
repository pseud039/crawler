import type { PolitenessComponent } from '../../interfaces/politeness.interface.js';
import redis from '../../frontier/redis.js';
import fetch from 'node-fetch';

const ROBOTS_CACHE_TTL_SECONDS = 24 * 60 * 60; // re-fetch robots.txt once a day per host
const USER_AGENT = 'CrawlKitBot';

interface RobotsRules {
  disallow: string[];
  allow: string[];
}

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

  private async getRobotsRules(url: string): Promise<RobotsRules> {
    const { origin } = new URL(url);
    const cacheKey = `robots:${origin}`;

    const cached = await redis.get(cacheKey);
    if (cached) return JSON.parse(cached);

    let rules: RobotsRules = { disallow: [], allow: [] };
    try {
      const res = await fetch(`${origin}/robots.txt`, {
        headers: { 'User-Agent': USER_AGENT },
        redirect: 'follow',
      });
      if (res.ok) {
        rules = this.parseRobotsTxt(await res.text());
      }
      // Non-200 (including 404) is treated as "no restrictions" per convention.
    } catch {
      // Unreachable robots.txt — fail open rather than blocking the whole domain.
    }

    await redis.set(cacheKey, JSON.stringify(rules), 'EX', ROBOTS_CACHE_TTL_SECONDS);
    return rules;
  }

  /** Minimal robots.txt parser: honors a matching UA block, falls back to `*`. */
  private parseRobotsTxt(text: string): RobotsRules {
    const lines = text.split('\n').map(l => l.split('#')[0].trim()).filter(Boolean);

    const blocks: Record<string, RobotsRules> = {};
    let currentAgents: string[] = [];

    for (const line of lines) {
      const [rawKey, ...rest] = line.split(':');
      const key = rawKey?.trim().toLowerCase();
      const value = rest.join(':').trim();
      if (!key || !value) continue;

      if (key === 'user-agent') {
        // A run of consecutive User-agent lines all apply to the rules that follow.
        if (currentAgents.length === 0 || blocks[currentAgents[0]]?.disallow.length || blocks[currentAgents[0]]?.allow.length) {
          currentAgents = [];
        }
        currentAgents.push(value.toLowerCase());
        for (const agent of currentAgents) {
          blocks[agent] ??= { disallow: [], allow: [] };
        }
      } else if (key === 'disallow' && currentAgents.length) {
        for (const agent of currentAgents) blocks[agent].disallow.push(value);
      } else if (key === 'allow' && currentAgents.length) {
        for (const agent of currentAgents) blocks[agent].allow.push(value);
      }
    }

    const specific = Object.keys(blocks).find(a => USER_AGENT.toLowerCase().includes(a) || a.includes(USER_AGENT.toLowerCase()));
    return blocks[specific ?? '*'] ?? { disallow: [], allow: [] };
  }

  private isPathAllowed(pathname: string, rules: RobotsRules): boolean {
    // Longest matching rule wins (standard robots.txt precedence).
    let bestMatch = { length: -1, allowed: true };
    for (const rule of rules.disallow) {
      if (rule === '') continue; // empty Disallow means "allow everything"
      if (pathname.startsWith(rule) && rule.length > bestMatch.length) {
        bestMatch = { length: rule.length, allowed: false };
      }
    }
    for (const rule of rules.allow) {
      if (pathname.startsWith(rule) && rule.length > bestMatch.length) {
        bestMatch = { length: rule.length, allowed: true };
      }
    }
    return bestMatch.allowed;
  }

  async shouldCrawl(urlOrDomain: string): Promise<boolean> {
    const host = this.extractDomain(urlOrDomain);
    const key = `domain:rate:${host}`;
    const last = await redis.get(key);
    const rateOk = !last || Date.now() - parseInt(last) >= this.delayMs;
    if (!rateOk) return false;

    if (this.respectRobots) {
      try {
        const url = urlOrDomain.includes('://') ? urlOrDomain : `https://${urlOrDomain}`;
        const rules = await this.getRobotsRules(url);
        const { pathname } = new URL(url);
        if (!this.isPathAllowed(pathname, rules)) return false;
      } catch {
        // Malformed URL passed in — don't let a robots check crash the crawl.
      }
    }

    return true;
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