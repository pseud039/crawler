export interface RevisitComponent {
  name: string
  type: 'revisit'
  init?(config: Record<string, any>): Promise<void>
  shouldRevisit(url: string, lastCrawledAt: Date): Promise<boolean>
  getNextVisitTime?(url: string): Promise<Date>
}