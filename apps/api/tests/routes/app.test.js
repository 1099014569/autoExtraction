import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createApp } from "../../src/app.js";
import { JobRepository } from "../../src/store/jobRepository.js";
const tempDirs = [];
const repositories = [];
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
        const extractedContent = {
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
                extract: async (url) => ({
                    url,
                    extracted: extractedContent
                })
            },
            rewriter: {
                rewrite: async (params) => ({
                    rewrittenText: `${params.sourceTitle}-${params.mode}`,
                    usage: {
                        totalTokens: 100
                    }
                })
            },
            exporter: {
                export: async (params) => {
                    const fileId = `file-${params.format}`;
                    const fileName = `${params.jobId}.${params.format}`;
                    const filePath = join(dir, fileName);
                    writeFileSync(filePath, params.text, "utf8");
                    return { fileId, fileName, filePath };
                }
            }
        });
        const extractResponse = await request(app).post("/api/v1/extract").send({ url: "https://example.com/post" });
        expect(extractResponse.status).toBe(200);
        expect(extractResponse.body.extracted.title).toBe("测试标题");
        const jobId = extractResponse.body.jobId;
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
});
