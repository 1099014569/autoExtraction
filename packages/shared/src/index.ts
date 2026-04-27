export type RewriteMode = "conservative" | "aggressive";

export type ExportFormat = "docx" | "pptx" | "pdf";

export interface ProviderConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface ExtractedContent {
  title: string;
  contentMarkdown: string;
  contentHtml: string;
  meta: {
    sourceUrl: string;
    byline?: string;
    excerpt?: string;
    lang?: string;
    siteName?: string;
    readingTimeMinutes?: number;
  };
}

export interface Job {
  id: string;
  url: string;
  extracted: ExtractedContent;
  rewrittenText: string | null;
  rewriteMode: RewriteMode | null;
  createdAt: number;
  updatedAt: number;
}

export interface ExportedFile {
  fileId: string;
  jobId: string;
  format: ExportFormat;
  fileName: string;
  downloadUrl: string;
  createdAt: number;
}

export interface ExtractRequest {
  url: string;
}

export interface ExtractResponse {
  jobId: string;
  extracted: ExtractedContent;
}

export interface ExtractBatchRequest {
  urls: string[];
}

export type ExtractBatchItem =
  | {
      inputUrl: string;
      status: "success";
      jobId: string;
      url: string;
      extracted: ExtractedContent;
    }
  | {
      inputUrl: string;
      status: "failed";
      error: string;
    };

export interface ExtractBatchResponse {
  total: number;
  successCount: number;
  failedCount: number;
  items: ExtractBatchItem[];
}

export interface RewriteRequest {
  jobId: string;
  mode: RewriteMode;
  promptExtra?: string;
  provider?: ProviderConfig;
}

export interface RewriteResponse {
  rewrittenText: string;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
}

export interface RewriteLocalState {
  provider: ProviderConfig;
  rewriteMode: RewriteMode;
  promptExtra: string;
  rewrittenText: string;
}

export interface ExportRequest {
  jobId: string;
  format: ExportFormat;
}

export interface ExportResponse {
  fileId: string;
  fileName: string;
  downloadUrl: string;
}
