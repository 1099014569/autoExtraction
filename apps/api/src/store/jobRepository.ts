import { existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { ExportFormat, ExportedFile, ExtractedContent, Job, RewriteMode } from "@autoextraction/shared";

interface JobRow {
  id: string;
  url: string;
  extracted_json: string;
  rewritten_text: string | null;
  rewrite_mode: RewriteMode | null;
  created_at: number;
  updated_at: number;
}

interface ExportRow {
  file_id: string;
  job_id: string;
  format: ExportFormat;
  file_name: string;
  file_path: string;
  created_at: number;
}

export class JobRepository {
  private readonly db: DatabaseSync;

  constructor(databasePath: string, private readonly storageDir: string) {
    mkdirSync(dirname(databasePath), { recursive: true });
    mkdirSync(storageDir, { recursive: true });
    this.db = new DatabaseSync(databasePath);
    this.db.exec("PRAGMA foreign_keys = ON;");
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.init();
  }

  close(): void {
    this.db.close();
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY,
        url TEXT NOT NULL,
        extracted_json TEXT NOT NULL,
        rewritten_text TEXT,
        rewrite_mode TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS exports (
        file_id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL,
        format TEXT NOT NULL,
        file_name TEXT NOT NULL,
        file_path TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        FOREIGN KEY(job_id) REFERENCES jobs(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_jobs_created_at ON jobs(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_exports_job_id ON exports(job_id);
    `);
  }

  createJob(params: { id: string; url: string; extracted: ExtractedContent }): Job {
    const now = Date.now();
    this.db
      .prepare(
        `
          INSERT INTO jobs(id, url, extracted_json, rewritten_text, rewrite_mode, created_at, updated_at)
          VALUES (?, ?, ?, NULL, NULL, ?, ?)
        `
      )
      .run(params.id, params.url, JSON.stringify(params.extracted), now, now);

    this.pruneToRecent100();
    const created = this.getJob(params.id);
    if (!created) {
      throw new Error("任务创建失败");
    }
    return created;
  }

  getJob(id: string): Job | null {
    const row = this.db.prepare("SELECT * FROM jobs WHERE id = ?").get(id) as JobRow | undefined;
    if (!row) {
      return null;
    }

    return this.toJob(row);
  }

  updateRewrite(params: { id: string; rewrittenText: string; rewriteMode: RewriteMode }): Job {
    const now = Date.now();
    this.db
      .prepare(
        `
          UPDATE jobs
          SET rewritten_text = ?,
              rewrite_mode = ?,
              updated_at = ?
          WHERE id = ?
        `
      )
      .run(params.rewrittenText, params.rewriteMode, now, params.id);

    const updated = this.getJob(params.id);
    if (!updated) {
      throw new Error("任务更新失败");
    }
    return updated;
  }

  addExport(params: {
    fileId: string;
    jobId: string;
    format: ExportFormat;
    fileName: string;
    filePath: string;
  }): ExportedFile {
    const now = Date.now();
    this.db
      .prepare(
        `
          INSERT INTO exports(file_id, job_id, format, file_name, file_path, created_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `
      )
      .run(params.fileId, params.jobId, params.format, params.fileName, params.filePath, now);

    return {
      fileId: params.fileId,
      jobId: params.jobId,
      format: params.format,
      fileName: params.fileName,
      downloadUrl: `/api/v1/download/${params.fileId}`,
      createdAt: now
    };
  }

  getExportById(fileId: string): (ExportedFile & { filePath: string }) | null {
    const row = this.db.prepare("SELECT * FROM exports WHERE file_id = ?").get(fileId) as ExportRow | undefined;
    if (!row) {
      return null;
    }
    return {
      fileId: row.file_id,
      jobId: row.job_id,
      format: row.format,
      fileName: row.file_name,
      filePath: row.file_path,
      downloadUrl: `/api/v1/download/${row.file_id}`,
      createdAt: row.created_at
    };
  }

  listJobs(limit: number): Array<Job & { exports: ExportedFile[] }> {
    const jobRows = this.db
      .prepare("SELECT * FROM jobs ORDER BY created_at DESC LIMIT ?")
      .all(limit) as unknown as JobRow[];

    const exportRows = this.db
      .prepare("SELECT * FROM exports ORDER BY created_at DESC")
      .all() as unknown as ExportRow[];

    const exportsByJob = new Map<string, ExportedFile[]>();
    for (const row of exportRows) {
      const item: ExportedFile = {
        fileId: row.file_id,
        jobId: row.job_id,
        format: row.format,
        fileName: row.file_name,
        downloadUrl: `/api/v1/download/${row.file_id}`,
        createdAt: row.created_at
      };
      const existing = exportsByJob.get(row.job_id);
      if (existing) {
        existing.push(item);
      } else {
        exportsByJob.set(row.job_id, [item]);
      }
    }

    return jobRows.map((row) => ({
      ...this.toJob(row),
      exports: exportsByJob.get(row.id) ?? []
    }));
  }

  private pruneToRecent100(): void {
    const staleExports = this.db
      .prepare(
        `
          SELECT * FROM exports
          WHERE job_id NOT IN (
            SELECT id FROM jobs ORDER BY created_at DESC LIMIT 100
          )
        `
      )
      .all() as unknown as ExportRow[];

    for (const row of staleExports) {
      if (existsSync(row.file_path)) {
        rmSync(row.file_path, { force: true });
      }
    }

    this.db.exec(`
      DELETE FROM exports
      WHERE job_id NOT IN (
        SELECT id FROM jobs ORDER BY created_at DESC LIMIT 100
      );
      DELETE FROM jobs
      WHERE id NOT IN (
        SELECT id FROM jobs ORDER BY created_at DESC LIMIT 100
      );
    `);
  }

  private toJob(row: JobRow): Job {
    return {
      id: row.id,
      url: row.url,
      extracted: JSON.parse(row.extracted_json) as ExtractedContent,
      rewrittenText: row.rewritten_text,
      rewriteMode: row.rewrite_mode,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }
}
