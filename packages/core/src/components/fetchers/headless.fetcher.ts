import { chromium, type Browser } from 'playwright';
import type { FetcherComponent } from '../../interfaces/fetchers.interface.js';
import type { FetchResult } from '../../types/shared.js';

export class HeadlessFetcher implements FetcherComponent {
  name = 'headless';
  type = 'fetcher' as const;

  private browser: Browser | null = null;
  private timeoutMs = 30_000;
  private userAgent = 'CrawlKit/1.0';

  async init(config: Record<string, any>): Promise<void> {
    if (config.timeoutMs) this.timeoutMs = config.timeoutMs;
    if (config.userAgent) this.userAgent = config.userAgent;
    // Launch browser once on init — reuse across fetches
    this.browser = await chromium.launch({ headless: true });
  }

  async fetch(url: string): Promise<FetchResult> {
    if (!this.browser) {
      this.browser = await chromium.launch({ headless: true });
    }

    const fetchedAt = new Date();
    const context = await this.browser.newContext({ userAgent: this.userAgent });
    const page = await context.newPage();

    try {
      const response = await page.goto(url, {
        waitUntil: 'networkidle',
        timeout: this.timeoutMs,
      });

      const html = await page.content();
      const status = response?.status() ?? 200;
      const headers = response?.headers() ?? {};

      return {
        html,
        statusCode: status,
        headers,
        fetchedAt,
      };
    } catch (err) {
      return {
        html: '',
        statusCode: 0,
        headers: {},
        fetchedAt,
        error: err instanceof Error ? err.message : String(err),
      };
    } finally {
      await context.close(); // close context, keep browser alive
    }
  }

  // Call this when worker shuts down
  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }
}