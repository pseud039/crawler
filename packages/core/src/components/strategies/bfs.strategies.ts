import type { ParseResult, ScoredUrl, JobConfig } from '../../types/index.js';
 import type { StrategyComponent } from '../../interfaces/strategies.interface.js';

export class BfsStrategy implements StrategyComponent {
  name = 'bfs';
  type = 'strategy' as const;

  async selectLinks(
    links: string[],
    _parseResult: ParseResult,
    _jobConfig: JobConfig
  ): Promise<ScoredUrl[]> {
    return links
      .filter(url => {
        try { new URL(url); return true; } catch { return false; }
      })
      .slice(0, 50) // cap per page to avoid explosion
      .map(url => ({ url, priority: 0, reason: 'bfs' }));
  }
}