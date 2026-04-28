import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createApp } from "../../src/app.js";
import { JobRepository } from "../../src/store/jobRepository.js";
import type {
  ExportFormat,
  ExtractedContent,
  ProviderConfig,
  RewriteLocalState,
  RewriteMode
} from "@autoextraction/shared";

const tempDirs: string[] = [];
const repositories: JobRepository[] = [];

const createMemoryRewriteLocalStateStore = () => {
  let state: RewriteLocalState = {
    provider: {
      baseUrl: "https://api.openai.com/v1",
      apiKey: "",
      model: "gpt-4o-mini"
    },
    rewriteMode: "conservative",
    promptExtra: "",
    rewrittenText: ""
  };

  return {
    getState: () => state,
    saveState: (nextState: RewriteLocalState) => {
      state = nextState;
      return state;
    }
  };
};

afterEach(() => {
  while (repositories.length > 0) {
    const repository = repositories.pop();
    repository?.close();
  }
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("API routes", () => {
  it("应完成提取、改写、导出、下载的基本闭环", async () => {
    const dir = mkdtempSync(join(tmpdir(), "autoextraction-app-"));
    tempDirs.push(dir);
    const repository = new JobRepository(join(dir, "api.db"), dir);
    repositories.push(repository);
    const extractedContent: ExtractedContent = {
      title: "测试标题",
      contentMarkdown: "测试正文",
      contentHtml: "<p>测试正文</p>",
      meta: {
        sourceUrl: "https://example.com/source"
      }
    };

    const app = createApp({
      repository,
      extractor: {
        extract: async (url: string) => ({
          url,
          extracted: extractedContent
        })
      },
      rewriter: {
        rewrite: async (params: {
          sourceTitle: string;
          sourceText: string;
          mode: RewriteMode;
          promptExtra?: string;
          provider?: ProviderConfig;
        }) => ({
          rewrittenText: `${params.sourceTitle}-${params.mode}`,
          usage: {
            totalTokens: 100
          }
        })
      },
      exporter: {
        export: async (params: { jobId: string; format: ExportFormat; text: string; title: string }) => {
          const fileId = `file-${params.format}`;
          const fileName = `${params.jobId}.${params.format}`;
          const filePath = join(dir, fileName);
          writeFileSync(filePath, params.text, "utf8");
          return { fileId, fileName, filePath };
        }
      },
      rewriteLocalStateStore: createMemoryRewriteLocalStateStore()
    });

    const extractResponse = await request(app).post("/api/v1/extract").send({ url: "https://example.com/post" });
    expect(extractResponse.status).toBe(200);
    expect(extractResponse.body.extracted.title).toBe("测试标题");
    const jobId = extractResponse.body.jobId as string;

    const rewriteResponse = await request(app)
      .post("/api/v1/rewrite")
      .send({ jobId, mode: "conservative", promptExtra: "语气正式" });
    expect(rewriteResponse.status).toBe(200);
    expect(rewriteResponse.body.rewrittenText).toContain("conservative");

    const exportResponse = await request(app).post("/api/v1/export").send({ jobId, format: "docx" });
    expect(exportResponse.status).toBe(200);
    expect(exportResponse.body.downloadUrl).toContain("/api/v1/download/");

    const downloadResponse = await request(app).get(exportResponse.body.downloadUrl);
    expect(downloadResponse.status).toBe(200);
    expect(readFileSync(join(dir, `${jobId}.docx`), "utf8")).toContain("conservative");

    const jobsResponse = await request(app).get("/api/v1/jobs?limit=100");
    expect(jobsResponse.status).toBe(200);
    expect(jobsResponse.body.jobs.length).toBe(1);
  });

  it("批量提取应支持部分成功返回", async () => {
    const dir = mkdtempSync(join(tmpdir(), "autoextraction-app-"));
    tempDirs.push(dir);
    const repository = new JobRepository(join(dir, "api.db"), dir);
    repositories.push(repository);
    const app = createApp({
      repository,
      extractor: {
        extract: async (url: string) => {
          if (url.includes("fail")) {
            throw new Error("提取失败");
          }
          return {
            url,
            extracted: {
              title: `标题-${url}`,
              contentMarkdown: "正文",
              contentHtml: "<p>正文</p>",
              meta: {
                sourceUrl: url
              }
            }
          };
        }
      },
      rewriter: {
        rewrite: async () => ({
          rewrittenText: "改写结果"
        })
      },
      exporter: {
        export: async (params: { jobId: string; format: ExportFormat; text: string; title: string }) => {
          const filePath = join(dir, `${params.jobId}.${params.format}`);
          writeFileSync(filePath, params.text, "utf8");
          return {
            fileId: `file-${params.jobId}`,
            fileName: `${params.jobId}.${params.format}`,
            filePath
          };
        }
      },
      rewriteLocalStateStore: createMemoryRewriteLocalStateStore()
    });

    const response = await request(app).post("/api/v1/extract/batch").send({
      urls: ["https://example.com/ok-1", "https://example.com/fail", "https://example.com/ok-2"]
    });

    expect(response.status).toBe(200);
    expect(response.body.total).toBe(3);
    expect(response.body.successCount).toBe(2);
    expect(response.body.failedCount).toBe(1);
    expect(response.body.items).toHaveLength(3);
    expect(response.body.items[1]?.status).toBe("failed");
  });

  it("批量改写应支持部分任务失败且不阻断其他任务", async () => {
    const dir = mkdtempSync(join(tmpdir(), "autoextraction-app-"));
    tempDirs.push(dir);
    const repository = new JobRepository(join(dir, "api.db"), dir);
    repositories.push(repository);
    const app = createApp({
      repository,
      extractor: {
        extract: async (url: string) => ({
          url,
          extracted: {
            title: `标题-${url}`,
            contentMarkdown: "正文",
            contentHtml: "<p>正文</p>",
            meta: {
              sourceUrl: url
            }
          }
        })
      },
      rewriter: {
        rewrite: async (params: {
          sourceTitle: string;
          sourceText: string;
          mode: RewriteMode;
          promptExtra?: string;
          provider?: ProviderConfig;
        }) => {
          if (params.sourceTitle.includes("fail")) {
            throw new Error("AI 改写失败");
          }
          return {
            rewrittenText: `${params.sourceTitle}-${params.mode}`
          };
        }
      },
      exporter: {
        export: async (params: { jobId: string; format: ExportFormat; text: string; title: string }) => {
          const filePath = join(dir, `${params.jobId}.${params.format}`);
          writeFileSync(filePath, params.text, "utf8");
          return {
            fileId: `file-${params.jobId}`,
            fileName: `${params.jobId}.${params.format}`,
            filePath
          };
        }
      },
      rewriteLocalStateStore: createMemoryRewriteLocalStateStore()
    });

    const first = await request(app).post("/api/v1/extract").send({ url: "https://example.com/ok" });
    const second = await request(app).post("/api/v1/extract").send({ url: "https://example.com/fail" });

    const response = await request(app).post("/api/v1/rewrite/batch").send({
      jobIds: [first.body.jobId, "missing-job", second.body.jobId],
      mode: "aggressive",
      promptExtra: "更直接"
    });

    expect(response.status).toBe(200);
    expect(response.body.total).toBe(3);
    expect(response.body.successCount).toBe(1);
    expect(response.body.failedCount).toBe(2);
    expect(response.body.items[0]).toMatchObject({
      status: "success",
      jobId: first.body.jobId,
      rewrittenText: "标题-https://example.com/ok-aggressive"
    });
    expect(response.body.items[1]).toMatchObject({
      status: "failed",
      jobId: "missing-job",
      error: "任务不存在"
    });
    expect(response.body.items[2]).toMatchObject({
      status: "failed",
      jobId: second.body.jobId,
      error: "AI 改写失败"
    });
  });

  it("批量改写缺少 API Key 时应返回清晰的单项失败原因", async () => {
    const dir = mkdtempSync(join(tmpdir(), "autoextraction-app-"));
    tempDirs.push(dir);
    const repository = new JobRepository(join(dir, "api.db"), dir);
    repositories.push(repository);
    const app = createApp({
      repository,
      extractor: {
        extract: async (url: string) => ({
          url,
          extracted: {
            title: "标题",
            contentMarkdown: "正文",
            contentHtml: "<p>正文</p>",
            meta: {
              sourceUrl: url
            }
          }
        })
      },
      rewriter: {
        rewrite: async (params: {
          sourceTitle: string;
          sourceText: string;
          mode: RewriteMode;
          promptExtra?: string;
          provider?: ProviderConfig;
        }) => {
          if (!params.provider?.apiKey) {
            throw new Error("缺少 AI API Key，请在页面填写或通过环境变量配置 OPENAI_API_KEY");
          }
          return {
            rewrittenText: "改写结果"
          };
        }
      },
      exporter: {
        export: async (params: { jobId: string; format: ExportFormat; text: string; title: string }) => {
          const filePath = join(dir, `${params.jobId}.${params.format}`);
          writeFileSync(filePath, params.text, "utf8");
          return {
            fileId: `file-${params.jobId}`,
            fileName: `${params.jobId}.${params.format}`,
            filePath
          };
        }
      },
      rewriteLocalStateStore: createMemoryRewriteLocalStateStore()
    });

    const extracted = await request(app).post("/api/v1/extract").send({ url: "https://example.com/needs-key" });
    const response = await request(app).post("/api/v1/rewrite/batch").send({
      jobIds: [extracted.body.jobId],
      mode: "conservative",
      provider: {
        baseUrl: "https://api.openai.com/v1",
        apiKey: "",
        model: "gpt-4o-mini"
      }
    });

    expect(response.status).toBe(200);
    expect(response.body.failedCount).toBe(1);
    expect(response.body.items[0]).toMatchObject({
      status: "failed",
      jobId: extracted.body.jobId,
      error: "缺少 AI API Key，请在页面填写或通过环境变量配置 OPENAI_API_KEY"
    });
  });

  it("批量导出应返回每个任务的文件或失败原因", async () => {
    const dir = mkdtempSync(join(tmpdir(), "autoextraction-app-"));
    tempDirs.push(dir);
    const repository = new JobRepository(join(dir, "api.db"), dir);
    repositories.push(repository);
    const app = createApp({
      repository,
      extractor: {
        extract: async (url: string) => ({
          url,
          extracted: {
            title: `标题-${url}`,
            contentMarkdown: "正文",
            contentHtml: "<p>正文</p>",
            meta: {
              sourceUrl: url
            }
          }
        })
      },
      rewriter: {
        rewrite: async (params: {
          sourceTitle: string;
          sourceText: string;
          mode: RewriteMode;
          promptExtra?: string;
          provider?: ProviderConfig;
        }) => ({
          rewrittenText: `${params.sourceTitle}-${params.mode}`
        })
      },
      exporter: {
        export: async (params: { jobId: string; format: ExportFormat; text: string; title: string }) => {
          const filePath = join(dir, `${params.jobId}.${params.format}`);
          writeFileSync(filePath, params.text, "utf8");
          return {
            fileId: `file-${params.jobId}`,
            fileName: `${params.jobId}.${params.format}`,
            filePath
          };
        }
      },
      rewriteLocalStateStore: createMemoryRewriteLocalStateStore()
    });

    const first = await request(app).post("/api/v1/extract").send({ url: "https://example.com/ready" });
    const second = await request(app).post("/api/v1/extract").send({ url: "https://example.com/raw" });
    await request(app).post("/api/v1/rewrite").send({ jobId: first.body.jobId, mode: "conservative" });

    const response = await request(app).post("/api/v1/export/batch").send({
      jobIds: [first.body.jobId, second.body.jobId, "missing-job"],
      format: "pdf"
    });

    expect(response.status).toBe(200);
    expect(response.body.total).toBe(3);
    expect(response.body.successCount).toBe(1);
    expect(response.body.failedCount).toBe(2);
    expect(response.body.items[0]).toMatchObject({
      status: "success",
      jobId: first.body.jobId,
      format: "pdf",
      downloadUrl: `/api/v1/download/file-${first.body.jobId}`
    });
    expect(response.body.items[1]).toMatchObject({
      status: "failed",
      jobId: second.body.jobId,
      error: "请先执行改写后再导出"
    });
    expect(response.body.items[2]).toMatchObject({
      status: "failed",
      jobId: "missing-job",
      error: "任务不存在"
    });
  });

  it("本地改写状态应支持读取与更新", async () => {
    const dir = mkdtempSync(join(tmpdir(), "autoextraction-app-"));
    tempDirs.push(dir);
    const repository = new JobRepository(join(dir, "api.db"), dir);
    repositories.push(repository);
    const rewriteLocalStateStore = createMemoryRewriteLocalStateStore();
    const app = createApp({
      repository,
      extractor: {
        extract: async (url: string) => ({
          url,
          extracted: {
            title: "标题",
            contentMarkdown: "正文",
            contentHtml: "<p>正文</p>",
            meta: {
              sourceUrl: url
            }
          }
        })
      },
      rewriter: {
        rewrite: async () => ({
          rewrittenText: "改写结果"
        })
      },
      exporter: {
        export: async (params: { jobId: string; format: ExportFormat; text: string; title: string }) => {
          const filePath = join(dir, `${params.jobId}.${params.format}`);
          writeFileSync(filePath, params.text, "utf8");
          return {
            fileId: `file-${params.jobId}`,
            fileName: `${params.jobId}.${params.format}`,
            filePath
          };
        }
      },
      rewriteLocalStateStore
    });

    const before = await request(app).get("/api/v1/rewrite-local-state");
    expect(before.status).toBe(200);
    expect(before.body.rewriteMode).toBe("conservative");

    const payload = {
      provider: {
        baseUrl: "https://api.openai.com/v1",
        apiKey: "local-key",
        model: "gpt-4o-mini"
      },
      rewriteMode: "aggressive",
      promptExtra: "更口语化",
      rewrittenText: "新的改写内容"
    };

    const updated = await request(app).put("/api/v1/rewrite-local-state").send(payload);
    expect(updated.status).toBe(200);
    expect(updated.body.rewriteMode).toBe("aggressive");

    const after = await request(app).get("/api/v1/rewrite-local-state");
    expect(after.status).toBe(200);
    expect(after.body).toEqual(payload);
  });
});
