export interface FetchResult {
  html: string
  statusCode: number
  headers: Record<string, string>
  fetchedAt: Date
  error?: string
}

export interface Entity {
  text: string
  type: 'person' | 'org' | 'place' | 'concept'
  confidence: number
}

export interface ParseResult {
  title: string
  cleanText: string
  links: string[]
  metadata: {
    author?: string
    publishedAt?: string
    language?: string
    wordCount?: number
  }
  entities?: Entity[]
  relevanceScore?: number
  embedding?: number[]
}

export interface ScoredUrl {
  url: string
  priority: number
  reason?: string
}