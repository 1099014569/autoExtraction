import { resolve } from "node:path";
import cors from "cors";
import express from "express";
import { nanoid } from "nanoid";
import { z } from "zod";
import type {
  ExportBatchItem,
  ExtractBatchItem,
  ExportFormat,
  ProviderConfig,
  RewriteBatchItem,
  RewriteLocalState,
  RewriteMode
} from "@autoextraction/shared";
import type { Exporter } from "./services/exportService.js";
import type { Extractor } from "./services/extractService.js";
import type { RewriteLocalStateStore } from "./services/rewriteLocalStateStore.js";
import type { Rewriter } from "./services/rewriteService.js";
import { JobRepository } from "./store/jobRepository.js";

export interface AppDependencies {
  repository: JobRepository;
  extractor: Extractor;
  rewriter: Rewriter;
  exporter: Exporter;
  rewriteLocalStateStore: RewriteLocalStateStore;
}

const extractSchema = z.object({
  url: z.string().url(),
  ignoreRobots: z.boolean().optional()
});

const extractBatchSchema = z.object({
  urls: z.array(z.string().trim().min(1)).min(1).max(20),
  ignoreRobots: z.boolean().optional()
});

const rewriteSchema = z.object({
  jobId: z.string().min(1),
  mode: z.enum(["conservative", "aggressive"]),
  promptExtra: z.string().optional(),
  provider: z
    .object({
      baseUrl: z.string().url(),
      apiKey: z.string(),
      model: z.string().min(1)
    })
    .optional()
});

const rewriteBatchSchema = rewriteSchema
  .omit({ jobId: true })
  .extend({
    jobIds: z.array(z.string().min(1)).min(1).max(20)
  });

const exportSchema = z.object({
  jobId: z.string().min(1),
  format: z.enum(["docx", "pptx", "pdf"])
});

const exportBatchSchema = exportSchema
  .omit({ jobId: true })
  .extend({
    jobIds: z.array(z.string().min(1)).min(1).max(20)
  });

const rewriteLocalStateSchema = z.object({
  provider: z.object({
    baseUrl: z.string(),
    apiKey: z.string(),
    model: z.string()
  }),
  rewriteMode: z.enum(["conservative", "aggressive"]),
  promptExtra: z.string(),
  rewrittenText: z.string()
});

export const createApp = (deps: AppDependencies) => {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: "4mb" }));

  app.get("/api/v1/health", (_req, res) => {
    res.json({ ok: true, now: Date.now() });
  });

  app.post("/api/v1/extract", async (req, res, next) => {
    try {
      const input = extractSchema.parse(req.body);
      const { url, extracted } = await deps.extractor.extract(input.url, {
        ignoreRobots: input.ignoreRobots
      });
      const job = deps.repository.createJob({
        id: nanoid(12),
        url,
        extracted
      });
      res.json({
        jobId: job.id,
        extracted: job.extracted
      });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/v1/extract/batch", async (req, res, next) => {
    try {
      const input = extractBatchSchema.parse(req.body);
      const items: ExtractBatchItem[] = [];
      let successCount = 0;
      let failedCount = 0;

      for (const inputUrl of input.urls) {
        try {
          const { url, extracted } = await deps.extractor.extract(inputUrl, {
            ignoreRobots: input.ignoreRobots
          });
          const job = deps.repository.createJob({
            id: nanoid(12),
            url,
            extracted
          });
          items.push({
            inputUrl,
            status: "success",
            jobId: job.id,
            url: job.url,
            extracted: job.extracted
          });
          successCount += 1;
        } catch (error) {
          items.push({
            inputUrl,
            status: "failed",
            error: error instanceof Error ? error.message : "提取失败"
          });
          failedCount += 1;
        }
      }

      res.json({
        total: input.urls.length,
        successCount,
        failedCount,
        items
      });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/v1/rewrite", async (req, res, next) => {
    try {
      const input = rewriteSchema.parse(req.body);
      const job = deps.repository.getJob(input.jobId);
      if (!job) {
        res.status(404).json({ message: "任务不存在" });
        return;
      }

      const rewritten = await deps.rewriter.rewrite({
        sourceTitle: job.extracted.title,
        sourceText: job.extracted.contentMarkdown || job.extracted.contentHtml,
        mode: input.mode as RewriteMode,
        ...(input.promptExtra ? { promptExtra: input.promptExtra } : {}),
        ...(input.provider ? { provider: input.provider as ProviderConfig } : {})
      });

      deps.repository.updateRewrite({
        id: input.jobId,
        rewrittenText: rewritten.rewrittenText,
        rewriteMode: input.mode as RewriteMode
      });

      res.json({
        rewrittenText: rewritten.rewrittenText,
        usage: rewritten.usage
      });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/v1/rewrite/batch", async (req, res, next) => {
    try {
      const input = rewriteBatchSchema.parse(req.body);
      const items: RewriteBatchItem[] = [];
      let successCount = 0;
      let failedCount = 0;

      for (const jobId of input.jobIds) {
        try {
          const job = deps.repository.getJob(jobId);
          if (!job) {
            throw new Error("任务不存在");
          }

          const rewritten = await deps.rewriter.rewrite({
            sourceTitle: job.extracted.title,
            sourceText: job.extracted.contentMarkdown || job.extracted.contentHtml,
            mode: input.mode as RewriteMode,
            ...(input.promptExtra ? { promptExtra: input.promptExtra } : {}),
            ...(input.provider ? { provider: input.provider as ProviderConfig } : {})
          });

          deps.repository.updateRewrite({
            id: jobId,
            rewrittenText: rewritten.rewrittenText,
            rewriteMode: input.mode as RewriteMode
          });

          items.push({
            jobId,
            status: "success",
            rewrittenText: rewritten.rewrittenText,
            ...(rewritten.usage ? { usage: rewritten.usage } : {})
          });
          successCount += 1;
        } catch (error) {
          items.push({
            jobId,
            status: "failed",
            error: error instanceof Error ? error.message : "改写失败"
          });
          failedCount += 1;
        }
      }

      res.json({
        total: input.jobIds.length,
        successCount,
        failedCount,
        items
      });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/v1/export", async (req, res, next) => {
    try {
      const input = exportSchema.parse(req.body);
      const job = deps.repository.getJob(input.jobId);
      if (!job) {
        res.status(404).json({ message: "任务不存在" });
        return;
      }
      if (!job.rewrittenText) {
        res.status(400).json({ message: "请先执行改写后再导出" });
        return;
      }

      const exported = await deps.exporter.export({
        jobId: input.jobId,
        format: input.format as ExportFormat,
        title: job.extracted.title,
        text: job.rewrittenText
      });

      deps.repository.addExport({
        fileId: exported.fileId,
        jobId: input.jobId,
        format: input.format as ExportFormat,
        fileName: exported.fileName,
        filePath: exported.filePath
      });

      res.json({
        fileId: exported.fileId,
        fileName: exported.fileName,
        downloadUrl: `/api/v1/download/${exported.fileId}`
      });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/v1/export/batch", async (req, res, next) => {
    try {
      const input = exportBatchSchema.parse(req.body);
      const items: ExportBatchItem[] = [];
      let successCount = 0;
      let failedCount = 0;

      for (const jobId of input.jobIds) {
        try {
          const job = deps.repository.getJob(jobId);
          if (!job) {
            throw new Error("任务不存在");
          }
          if (!job.rewrittenText) {
            throw new Error("请先执行改写后再导出");
          }

          const exported = await deps.exporter.export({
            jobId,
            format: input.format as ExportFormat,
            title: job.extracted.title,
            text: job.rewrittenText
          });

          deps.repository.addExport({
            fileId: exported.fileId,
            jobId,
            format: input.format as ExportFormat,
            fileName: exported.fileName,
            filePath: exported.filePath
          });

          items.push({
            jobId,
            status: "success",
            fileId: exported.fileId,
            format: input.format as ExportFormat,
            fileName: exported.fileName,
            downloadUrl: `/api/v1/download/${exported.fileId}`
          });
          successCount += 1;
        } catch (error) {
          items.push({
            jobId,
            status: "failed",
            error: error instanceof Error ? error.message : "导出失败"
          });
          failedCount += 1;
        }
      }

      res.json({
        total: input.jobIds.length,
        successCount,
        failedCount,
        items
      });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/v1/rewrite-local-state", (_req, res, next) => {
    try {
      const state = deps.rewriteLocalStateStore.getState();
      res.json(state);
    } catch (error) {
      next(error);
    }
  });

  app.put("/api/v1/rewrite-local-state", (req, res, next) => {
    try {
      const input = rewriteLocalStateSchema.parse(req.body);
      const state = deps.rewriteLocalStateStore.saveState(input as RewriteLocalState);
      res.json(state);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/v1/download/:fileId", (req, res) => {
    const found = deps.repository.getExportById(req.params.fileId);
    if (!found) {
      res.status(404).json({ message: "文件不存在" });
      return;
    }
    res.download(resolve(found.filePath), found.fileName);
  });

  app.get("/api/v1/jobs", (req, res) => {
    const limit = Number(req.query.limit ?? 100);
    const finalLimit = Number.isNaN(limit) ? 100 : Math.min(Math.max(limit, 1), 100);
    const jobs = deps.repository.listJobs(finalLimit);
    res.json({ jobs });
  });

  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const message = error instanceof Error ? error.message : "服务器内部错误";
    res.status(400).json({
      message
    });
  });

  return app;
};
