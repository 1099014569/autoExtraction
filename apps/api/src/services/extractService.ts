import { chromium } from "playwright";
import type { ExtractedContent } from "@autoextraction/shared";
import { parseRenderedPage } from "./articleParser.js";
import { ensureRobotsAllowed } from "./robots.js";
import { HostRateLimiter } from "./rateLimiter.js";

export interface Extractor {
  extract: (url: string) => Promise<{ url: string; extracted: ExtractedContent }>;
}

export class PlaywrightExtractor implements Extractor {
  constructor(
    private readonly userAgent: string,
    private readonly rateLimiter: HostRateLimiter
  ) {}

  async extract(url: string): Promise<{ url: string; extracted: ExtractedContent }> {
    await ensureRobotsAllowed({
      targetUrl: url,
      userAgent: this.userAgent
    });
    await this.rateLimiter.waitForTurn(url);

    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        userAgent: this.userAgent
      });
      await page.goto(url, { waitUntil: "networkidle", timeout: 45_000 });
      await page.waitForTimeout(800);

      const renderedHtml = await page.content();
      const finalUrl = page.url();
      const pageTitle = await page.title();
      const extracted = parseRenderedPage({
        html: renderedHtml,
        url: finalUrl,
        fallbackTitle: pageTitle
      });

      return {
        url: finalUrl,
        extracted
      };
    } finally {
      await browser.close();
    }
  }
}
