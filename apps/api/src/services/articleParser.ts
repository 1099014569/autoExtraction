import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";
import TurndownService from "turndown";
import type { ExtractedContent } from "@autoextraction/shared";

const turndownService = new TurndownService({
  headingStyle: "atx",
  bulletListMarker: "-",
  codeBlockStyle: "fenced"
});

export const parseRenderedPage = (params: {
  html: string;
  url: string;
  fallbackTitle?: string;
}): ExtractedContent => {
  const dom = new JSDOM(params.html, { url: params.url });
  const parsed = new Readability(dom.window.document).parse();

  const contentHtml = parsed?.content ?? dom.window.document.body.innerHTML;
  const contentMarkdown = turndownService.turndown(contentHtml).trim();
  const title =
    parsed?.title?.trim() || params.fallbackTitle?.trim() || dom.window.document.title || "未命名文章";
  const length = parsed?.length ?? contentMarkdown.length;
  const documentLang = dom.window.document.documentElement.lang || undefined;
  const meta = {
    sourceUrl: params.url,
    readingTimeMinutes: Math.max(1, Math.ceil(length / 600)),
    ...(parsed?.byline ? { byline: parsed.byline } : {}),
    ...(parsed?.excerpt ? { excerpt: parsed.excerpt } : {}),
    ...(parsed?.lang
      ? { lang: parsed.lang }
      : documentLang
        ? { lang: documentLang }
        : {}),
    ...(parsed?.siteName ? { siteName: parsed.siteName } : {})
  };

  return {
    title,
    contentHtml,
    contentMarkdown,
    meta
  };
};
