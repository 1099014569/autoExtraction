import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import { Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";
import sanitizeFilename from "sanitize-filename";
import { nanoid } from "nanoid";
import type { ExportFormat } from "@autoextraction/shared";

export interface Exporter {
  export: (params: {
    jobId: string;
    format: ExportFormat;
    title: string;
    text: string;
  }) => Promise<{
    fileId: string;
    fileName: string;
    filePath: string;
  }>;
}

const escapeHtml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");

const splitParagraphs = (text: string): string[] =>
  text
    .split(/\n+/)
    .map((item) => item.trim())
    .filter(Boolean);

export class FileExporter implements Exporter {
  private readonly exportsDir: string;

  constructor(storageDir: string) {
    this.exportsDir = join(storageDir, "exports");
    mkdirSync(this.exportsDir, { recursive: true });
  }

  async export(params: {
    jobId: string;
    format: ExportFormat;
    title: string;
    text: string;
  }): Promise<{ fileId: string; fileName: string; filePath: string }> {
    const fileId = nanoid(12);
    const baseName = sanitizeFilename(params.title) || "article";
    const fileName = `${baseName}-${params.jobId}.${params.format}`;
    const filePath = join(this.exportsDir, fileName);

    if (params.format === "docx") {
      await this.exportDocx(filePath, params.title, params.text);
    } else if (params.format === "pptx") {
      await this.exportPptx(filePath, params.title, params.text);
    } else {
      await this.exportPdf(filePath, params.title, params.text);
    }

    return {
      fileId,
      fileName,
      filePath
    };
  }

  private async exportDocx(filePath: string, title: string, text: string): Promise<void> {
    const paragraphs = splitParagraphs(text);
    const document = new Document({
      sections: [
        {
          children: [
            new Paragraph({
              heading: HeadingLevel.HEADING_1,
              children: [new TextRun(title)]
            }),
            ...paragraphs.map((item) => new Paragraph(item))
          ]
        }
      ]
    });

    const buffer = await Packer.toBuffer(document);
    writeFileSync(filePath, buffer);
  }

  private async exportPptx(filePath: string, title: string, text: string): Promise<void> {
    const module = (await import("pptxgenjs")) as unknown as { default: new () => any };
    const PptxGenJS = module.default;
    const pptx = new PptxGenJS();
    pptx.author = "AutoExtraction";
    pptx.subject = "AI 洗稿结果";
    pptx.title = title;
    pptx.layout = "LAYOUT_WIDE";

    const paragraphs = splitParagraphs(text);
    const chunks: string[][] = [];
    for (let index = 0; index < paragraphs.length; index += 5) {
      chunks.push(paragraphs.slice(index, index + 5));
    }

    const cover = pptx.addSlide();
    cover.background = { color: "F8FAFC" };
    cover.addText(title, {
      x: 0.8,
      y: 1.2,
      w: 11.5,
      h: 1.2,
      fontSize: 32,
      bold: true,
      color: "0F172A"
    });
    cover.addText("AutoExtraction 自动生成", {
      x: 0.8,
      y: 2.5,
      w: 6,
      h: 0.6,
      fontSize: 14,
      color: "334155"
    });

    const outline = pptx.addSlide();
    outline.addText("目录", {
      x: 0.8,
      y: 0.6,
      w: 4,
      h: 0.6,
      fontSize: 24,
      bold: true
    });
    outline.addText(
      chunks.map((_, index) => `第 ${index + 1} 节`).join("\n") || "正文",
      {
        x: 1.0,
        y: 1.4,
        w: 8,
        h: 4.5,
        fontSize: 18,
        color: "1E293B",
        breakLine: true
      }
    );

    chunks.forEach((chunk, index) => {
      const slide = pptx.addSlide();
      slide.addText(`第 ${index + 1} 节`, {
        x: 0.7,
        y: 0.5,
        w: 5,
        h: 0.5,
        fontSize: 20,
        bold: true,
        color: "0F172A"
      });
      slide.addText(
        chunk.map((item) => `• ${item}`).join("\n"),
        {
          x: 0.9,
          y: 1.3,
          w: 11,
          h: 5.2,
          fontSize: 16,
          color: "0F172A",
          breakLine: true
        }
      );
    });

    const summary = pptx.addSlide();
    summary.addText("总结", {
      x: 0.8,
      y: 0.8,
      w: 3,
      h: 0.6,
      fontSize: 24,
      bold: true
    });
    summary.addText(paragraphs.slice(0, 4).join("\n") || "暂无内容", {
      x: 0.9,
      y: 1.8,
      w: 11,
      h: 4.5,
      fontSize: 16,
      breakLine: true
    });

    await pptx.writeFile({ fileName: filePath });
  }

  private async exportPdf(filePath: string, title: string, text: string): Promise<void> {
    const paragraphs = splitParagraphs(text)
      .map((item) => `<p>${escapeHtml(item)}</p>`)
      .join("");
    const html = `
      <!doctype html>
      <html lang="zh-CN">
        <head>
          <meta charset="UTF-8" />
          <style>
            body { font-family: "Noto Sans CJK SC", "Microsoft YaHei", sans-serif; margin: 48px; color: #0f172a; }
            h1 { font-size: 28px; margin-bottom: 24px; }
            p { font-size: 14px; line-height: 1.7; margin: 0 0 12px; }
          </style>
        </head>
        <body>
          <h1>${escapeHtml(title)}</h1>
          ${paragraphs}
        </body>
      </html>
    `;

    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: "load" });
      await page.pdf({
        path: filePath,
        format: "A4",
        printBackground: true
      });
    } finally {
      await browser.close();
    }
  }
}
