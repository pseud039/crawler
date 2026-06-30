import { Readability } from '@mozilla/readability';
import * as cheerio from 'cheerio';
import { JSDOM } from 'jsdom';
import OpenAI from 'openai';
import type { ParserComponent } from '../../interfaces/parsers.interface.js';
import type { ParseResult,Entity } from '../../types/shared.js';

export class SemanticParser implements ParserComponent {
  name = 'semantic';
  type = 'parser' as const;

  private client: OpenAI | null = null;

  private getClient(): OpenAI {
    if (!this.client) {
      this.client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    }
    return this.client;
  }

  async init(_config: Record<string, any>): Promise<void> {}

  async parse(html: string, url: string): Promise<ParseResult> {
    const dom = new JSDOM(html, { url });
    const reader = new Readability(dom.window.document);
    const article = reader.parse();

    const cleanText = article?.textContent ?? '';

    const $ = cheerio.load(html);
    const links: string[] = [];
    $('a[href]').each((_, el) => {
      const href = $(el).attr('href');
      if (!href) return;
      try { links.push(new URL(href, url).toString()); } catch { }
    });

    let embedding: number[] | undefined;
    if (cleanText.trim().length > 0) {
      const truncated = cleanText.slice(0, 8000);
      const response: { data: { embedding: number[] }[] } = await this.getClient().embeddings.create({
        model: 'text-embedding-3-small',
        input: truncated,
      });
      embedding = response.data[0]?.embedding;
    }

    const entities: Entity[] = this.extractEntities(cleanText);

    return {
      title: article?.title ?? '',
      cleanText,
      links,
      metadata: {
        ...(article?.byline ? { author: article.byline } : {}),
        ...(article?.lang ? { language: article.lang } : {}),
        wordCount: cleanText.split(/\s+/).length,
      },
      entities,
      embedding,
    };
  }

  private extractEntities(text: string): Entity[] {
    const pattern = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\b/g;
    const matches = new Set<string>();
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      matches.add(match[1] as string);
    }
    return Array.from(matches)
      .slice(0, 20)
      .map(text => ({
        text,
        type: 'concept',
        confidence: 0.6,
      }));
  }
}