import type { ParseResult } from '../types/shared.ts'

export interface ParserComponent {
  name: string
  type: 'parser'
  init?(config: Record<string, any>): Promise<void>
  parse(html: string, url: string): Promise<ParseResult>
}