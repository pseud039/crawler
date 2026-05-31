import fetch from 'node-fetch'
import type { FetcherComponent } from '../../interfaces/fetchers.interface.js'
import type { FetchResult } from '../../types/shared.js'

export class HttpFetcher implements FetcherComponent {
  name = 'http'
  type = 'fetcher' as const

  private userAgent = 'CrawlKit/1.0'
  private timeoutMs = 10_000

  async init(config: Record<string, any>): Promise<void> {
    if (config.userAgent) this.userAgent = config.userAgent
    if (config.timeoutMs) this.timeoutMs = config.timeoutMs
  }

  async fetch(url: string): Promise<FetchResult> {
    const fetchedAt = new Date()

    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': this.userAgent },
        signal: AbortSignal.timeout(this.timeoutMs)
      })

      return {
        html: await response.text(),
        statusCode: response.status,
        headers: Object.fromEntries(response.headers.entries()),
        fetchedAt
      }

    } catch (err) {
      return {
        html: '',
        statusCode: 0,
        headers: {},
        fetchedAt,
        error: err instanceof Error ? err.message : String(err)
      }
    }
  }
}