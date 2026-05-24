export interface PolitenessComponent {
  name: string
  type: 'politeness'
  init?(config: Record<string, any>): Promise<void>
  shouldCrawl(domain: string): Promise<boolean>
  getDelay(domain: string): Promise<number>
  onCrawled(domain: string): Promise<void>
}