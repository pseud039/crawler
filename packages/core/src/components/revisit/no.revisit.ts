import type { RevisitComponent } from '../../interfaces/revisit.interface.js';

export class NoRevisit implements RevisitComponent {
  name = 'none';
  type = 'revisit' as const;

  async init(_config: Record<string, any>): Promise<void> {}

  async shouldRevisit(_url: string, _lastCrawledAt: Date): Promise<boolean> {
    return false; // never revisit
  }
}