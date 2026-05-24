import type { ParseResult, ScoredUrl } from '../types/shared.ts'
import type { JobConfig } from '../types/config.ts'

export interface StrategyComponent {
  name: string
  type: 'strategy'
  init?(config: Record<string, any>): Promise<void>
  selectLinks(
    links: string[],
    parseResult: ParseResult,
    jobConfig: JobConfig
  ): Promise<ScoredUrl[]>
}