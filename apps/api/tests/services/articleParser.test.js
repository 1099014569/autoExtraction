import { describe, expect, it } from "vitest";
import { parseRenderedPage } from "../../src/services/articleParser.js";
describe("parseRenderedPage", () => {
    it("静态样例1：标准文章结构可以正确抽取", () => {
        const html = `
      <html><head><title>静态文章A</title></head><body>
      <article><h1>静态文章A</h1><p>第一段内容。</p><p>第二段内容。</p></article>
      </body></html>
    `;
        const result = parseRenderedPage({ html, url: "https://example.com/a", fallbackTitle: "A" });
        expect(result.title).toContain("静态文章A");
        expect(result.contentMarkdown).toContain("第一段内容");
    });
    it("静态样例2：复杂包裹层仍可抽取正文", () => {
        const html = `
      <html><head><title>静态文章B</title></head><body>
      <div id="app"><main><section><article><h1>静态文章B</h1><p>这是一篇带容器结构的正文。</p></article></section></main></div>
      </body></html>
    `;
        const result = parseRenderedPage({ html, url: "https://example.com/b", fallbackTitle: "B" });
        expect(result.title).toContain("静态文章B");
        expect(result.contentHtml).toContain("容器结构");
    });
    it("静态样例3：无 article 标签时降级到 body 抽取", () => {
        const html = `
      <html><head><title>静态文章C</title></head><body>
      <h1>静态文章C</h1><p>正文来自 body fallback。</p>
      </body></html>
    `;
        const result = parseRenderedPage({ html, url: "https://example.com/c", fallbackTitle: "C" });
        expect(result.title).toContain("静态文章C");
        expect(result.contentMarkdown).toContain("body fallback");
    });
    it("动态样例1：渲染后正文内容可识别", () => {
        const renderedHtml = `
      <html><head><title>动态文章A</title></head><body>
      <article><h1>动态文章A</h1><p>这是渲染后插入的正文A。</p></article>
      </body></html>
    `;
        const result = parseRenderedPage({ html: renderedHtml, url: "https://example.com/d1", fallbackTitle: "D1" });
        expect(result.contentMarkdown).toContain("渲染后插入的正文A");
    });
    it("动态样例2：懒加载区块渲染后可抽取", () => {
        const renderedHtml = `
      <html><head><title>动态文章B</title></head><body>
      <div class="lazy-loaded"><h1>动态文章B</h1><p>懒加载正文B。</p></div>
      </body></html>
    `;
        const result = parseRenderedPage({ html: renderedHtml, url: "https://example.com/d2", fallbackTitle: "D2" });
        expect(result.title).toContain("动态文章B");
        expect(result.contentHtml).toContain("懒加载正文B");
    });
    it("动态样例3：SPA 渲染后的标题和内容可保持一致", () => {
        const renderedHtml = `
      <html><head><title>动态文章C</title></head><body>
      <main><h1>动态文章C</h1><p>SPA 页面渲染完成。</p></main>
      </body></html>
    `;
        const result = parseRenderedPage({ html: renderedHtml, url: "https://example.com/d3", fallbackTitle: "D3" });
        expect(result.title).toContain("动态文章C");
        expect(result.contentMarkdown).toContain("SPA 页面渲染完成");
    });
});
