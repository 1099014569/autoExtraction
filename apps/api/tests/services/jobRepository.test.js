import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { JobRepository } from "../../src/store/jobRepository.js";
const tempDirs = [];
const repositories = [];
const sampleExtracted = {
    title: "标题",
    contentMarkdown: "正文",
    contentHtml: "<p>正文</p>",
    meta: {
        sourceUrl: "https://example.com"
    }
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
describe("JobRepository", () => {
    it("应只保留最近 100 条任务", () => {
        const dir = mkdtempSync(join(tmpdir(), "autoextraction-"));
        tempDirs.push(dir);
        const repository = new JobRepository(join(dir, "test.db"), dir);
        repositories.push(repository);
        for (let index = 0; index < 120; index += 1) {
            repository.createJob({
                id: `job-${index}`,
                url: `https://example.com/${index}`,
                extracted: {
                    ...sampleExtracted,
                    title: `标题-${index}`
                }
            });
        }
        const recentJobs = repository.listJobs(200);
        expect(recentJobs.length).toBe(100);
        expect(recentJobs[0]?.id).toBe("job-119");
        expect(recentJobs[99]?.id).toBe("job-20");
    });
});
