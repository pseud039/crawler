import { Readability } from '@mozilla/readability';
import * as cheerio from 'cheerio';
import { JSDOM } from 'jsdom';
import OpenAI from 'openai';
import type { ParserComponent } from '../../interfaces/parsers.interface.js';
import type { ParseResult } from '../../types/shared.js';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export class SemanticParser implements ParserComponent {
  name = 'semantic';
  type = 'parser' as const;

  async init(_config: Record<string, any>): Promise<void> {}

  async parse(html: string, url: string): Promise<ParseResult> {
    // 1. Extract readable content (same as ReadabilityParser)
    const dom = new JSDOM(html, { url });
    const reader = new Readability(dom.window.document);
    const article = reader.parse();

    const cleanText = article?.textContent ?? '';

    // 2. Extract links via cheerio
    const $ = cheerio.load(html);
    const links: string[] = [];
    $('a[href]').each((_, el) => {
      const href = $(el).attr('href');
      if (!href) return;
      try { links.push(new URL(href, url).toString()); } catch { }
    });

    // 3. Get embedding from OpenAI
    let embedding: number[] | undefined;
    if (cleanText.trim().length > 0) {
      const truncated = cleanText.slice(0, 8000); // stay within token limit
      const response = await openai.embeddings.create({
        model: 'text-embedding-3-small',
        input: truncated,
      });
      embedding = response.data[0].embedding;
    }

    // 4. Simple entity extraction via noun phrases (no NLP lib needed)
    const entities = this.extractEntities(cleanText);

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

  // Lightweight entity extraction — capitalised multi-word phrases
  private extractEntities(text: string): Array<{ text: string; type: string; confidence: number }> {
    const pattern = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\b/g;
    const matches = new Set<string>();
    let match;
    while ((match = pattern.exec(text)) !== null) {
      matches.add(match[1]);
    }
    return Array.from(matches)
      .slice(0, 20) // cap at 20 entities per page
      .map(text => ({
        text,
        type: 'concept', // without a real NLP model, type is best-effort
        confidence: 0.6,
      }));
  }
}