import type { FetchResult } from '../types/shared.ts'

export interface FetcherComponent {
  name: string
  type: 'fetcher'
  init?(config: Record<string, any>): Promise<void>
  fetch(url: string): Promise<FetchResult>
}