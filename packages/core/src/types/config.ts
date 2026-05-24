export interface JobConfig {
  name?: string
  seed_urls: string[]
  depth: number
  max_pages: number
  components: {
    fetcher: string
    parser: string
    strategy: string
    politeness: string
    revisit: string
  }
  strategy_config?: Record<string, any>
  politeness_config?: Record<string, any>
  revisit_config?: Record<string, any>
  output: {
    format: 'json'
    path: string
    vector_db?: 'qdrant' | 'pinecone' | 'none'
    vector_db_url?: string
  }
}

export interface CrawlDocument {
  url: string
  title: string
  cleanText: string
  metadata: {
    author?: string
    publishedAt?: string
    language?: string
    wordCount: number
    crawledAt: string
    httpStatus: number
  }
  entities?: import('./shared.ts').Entity[]
  relevanceScore?: number
  embedding?: number[]
}

export interface CrawlStats {
  crawled: number
  failed: number
  queued: number
  bytesfetched: number
}