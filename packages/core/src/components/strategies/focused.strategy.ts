import type { StrategyComponent } from '../../interfaces/strategies.interface.js';
import type { ParseResult, ScoredUrl } from '../../types/shared.js';
import type { JobConfig } from '../../types/config.js';

export class FocusedStrategy implements StrategyComponent {
  name = 'focused';
  type = 'strategy' as const;

  private topics: string[] = [];
  private threshold = 0.3;
  private maxLinks = 50;

  async init(config: Record<string, any>): Promise<void> {
    if (config.topics) this.topics = config.topics.map((t: string) => t.toLowerCase());
    if (config.threshold !== undefined) this.threshold = config.threshold;
    if (config.maxLinks) this.maxLinks = config.maxLinks;
  }

  private scoreUrl(url: string, parseResult: ParseResult): number {
    if (this.topics.length === 0) return 1; // no filter = accept all
    const text = (url + ' ' + parseResult.title).toLowerCase();
    const matches = this.topics.filter(t => text.includes(t)).length;
    return matches / this.topics.length;
  }

  async selectLinks(
    links: string[],
    parseResult: ParseResult,
    _jobConfig: JobConfig
  ): Promise<ScoredUrl[]> {
    return links
      .filter(url => {
        try { new URL(url); return true; } catch { return false; }
      })
      .map(url => ({
        url,
        priority: this.scoreUrl(url, parseResult),
        reason: 'focused',
      }))
      .filter(u => u.priority >= this.threshold)
      .sort((a, b) => b.priority - a.priority)
      .slice(0, this.maxLinks);
  }
}