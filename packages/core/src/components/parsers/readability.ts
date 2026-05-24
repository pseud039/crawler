import { Readability } from '@mozilla/readability'
import * as cheerio from 'cheerio'
import type { ParserComponent } from '../../interfaces/parsers.interface.js'
import type { ParseResult } from '../../types/shared.js'
const { JSDOM } = require('jsdom') as {
  JSDOM: new (html: string, options?: { url?: string }) => {
    window: { document: Document }
  }
}

export class ReadabilityParser implements ParserComponent {
  name = 'readability'
  type = 'parser' as const
  
  async init(_config: Record<string, any>): Promise<void> {}

  async parse(html: string, url: string): Promise<ParseResult> {
    const dom = new JSDOM(html, { url })
    const reader = new Readability(dom.window.document)
    const article = reader.parse()

    // cheerio handles link extraction separately
    const $ = cheerio.load(html)
    const links: string[] = []

    $('a[href]').each((_, el) => {
      const href = $(el).attr('href')
      if (!href) return

      try {
        const absolute = new URL(href, url).toString()
        links.push(absolute)
      } catch {
        // invalid URL, skip it
      }
    })

    return {
      title: article?.title ?? '',
      cleanText: article?.textContent ?? '',
      links,
      metadata: {
        ...(article?.byline ? { author: article.byline } : {}),
        ...(article?.lang ? { language: article.lang } : {}),
        wordCount: article?.textContent?.split(/\s+/).length ?? 0
      }
    }
  }
}