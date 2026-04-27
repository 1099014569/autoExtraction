import { useEffect, useMemo, useState } from "react";
import type {
  ExtractBatchItem,
  ExtractBatchResponse,
  ExportFormat,
  ExportResponse,
  Job,
  ProviderConfig,
  RewriteLocalState,
  RewriteMode,
  RewriteResponse
} from "@autoextraction/shared";

type JobWithExports = Job & {
  exports: Array<{
    fileId: string;
    format: ExportFormat;
    fileName: string;
    downloadUrl: string;
    createdAt: number;
  }>;
};

const API_BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:8787";
const MAX_BATCH_URLS = 20;
const LOCAL_STATE_SAVE_DEBOUNCE_MS = 500;
const DEFAULT_PROVIDER: ProviderConfig = {
  baseUrl: "https://api.openai.com/v1",
  apiKey: "",
  model: "gpt-4o-mini"
};

const parseUrlsFromInput = (value: string): string[] =>
  value
    .split(/[\s,，]+/)
    .map((item) => item.trim())
    .filter(Boolean);

const App = () => {
  const [urlInput, setUrlInput] = useState("");
  const [extractItems, setExtractItems] = useState<ExtractBatchItem[]>([]);
  const [selectedExtractIndex, setSelectedExtractIndex] = useState<number | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [extractResult, setExtractResult] = useState<Job["extracted"] | null>(null);
  const [rewrittenText, setRewrittenText] = useState("");
  const [rewriteMode, setRewriteMode] = useState<RewriteMode>("conservative");
  const [promptExtra, setPromptExtra] = useState("");
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState<JobWithExports[]>([]);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [provider, setProvider] = useState<ProviderConfig>(DEFAULT_PROVIDER);
  const [error, setError] = useState("");
  const [localStateReady, setLocalStateReady] = useState(false);

  const canRewrite = Boolean(jobId && extractResult);
  const canExport = Boolean(jobId && rewrittenText.trim());

  const parsedUrls = useMemo(() => parseUrlsFromInput(urlInput), [urlInput]);
  const overBatchLimit = parsedUrls.length > MAX_BATCH_URLS;
  const canExtract = parsedUrls.length > 0 && !overBatchLimit;

  const sortedHistory = useMemo(
    () => [...history].sort((a, b) => b.createdAt - a.createdAt),
    [history]
  );

  const selectedExtractItem =
    selectedExtractIndex === null ? null : (extractItems[selectedExtractIndex] ?? null);

  const request = async <T,>(path: string, init?: RequestInit): Promise<T> => {
    const response = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        ...(init?.headers ?? {})
      }
    });

    const body = (await response.json()) as T & { message?: string };
    if (!response.ok) {
      throw new Error(body.message ?? "请求失败");
    }
    return body;
  };

  const refreshJobs = async () => {
    const jobsData = await request<{ jobs: JobWithExports[] }>("/api/v1/jobs?limit=100");
    setHistory(jobsData.jobs);
  };

  const loadRewriteLocalState = async () => {
    try {
      const state = await request<RewriteLocalState>("/api/v1/rewrite-local-state");
      setProvider(state.provider);
      setRewriteMode(state.rewriteMode);
      setPromptExtra(state.promptExtra);
      setRewrittenText(state.rewrittenText);
    } catch {
      // 本地状态加载失败时回退到默认值，避免阻断主流程。
    } finally {
      setLocalStateReady(true);
    }
  };

  useEffect(() => {
    void refreshJobs();
    void loadRewriteLocalState();
  }, []);

  useEffect(() => {
    if (!localStateReady) {
      return;
    }

    const timer = window.setTimeout(() => {
      void request<RewriteLocalState>("/api/v1/rewrite-local-state", {
        method: "PUT",
        body: JSON.stringify({
          provider,
          rewriteMode,
          promptExtra,
          rewrittenText
        } satisfies RewriteLocalState)
      });
    }, LOCAL_STATE_SAVE_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timer);
    };
  }, [provider, rewriteMode, promptExtra, rewrittenText, localStateReady]);

  const handleExtract = async () => {
    if (!canExtract) {
      if (overBatchLimit) {
        setError(`单次最多支持 ${MAX_BATCH_URLS} 条 URL`);
      }
      return;
    }

    setError("");
    setLoading(true);
    try {
      const response = await request<ExtractBatchResponse>("/api/v1/extract/batch", {
        method: "POST",
        body: JSON.stringify({ urls: parsedUrls })
      });
      setExtractItems(response.items);

      const firstSuccessIndex = response.items.findIndex((item) => item.status === "success");
      if (firstSuccessIndex >= 0) {
        const firstSuccess = response.items[firstSuccessIndex];
        if (firstSuccess && firstSuccess.status === "success") {
          setSelectedExtractIndex(firstSuccessIndex);
          setJobId(firstSuccess.jobId);
          setExtractResult(firstSuccess.extracted);
          setRewrittenText("");
        }
      } else {
        setSelectedExtractIndex(response.items.length > 0 ? 0 : null);
        setJobId(null);
        setExtractResult(null);
        setRewrittenText("");
      }

      await refreshJobs();
    } catch (err) {
      setError(err instanceof Error ? err.message : "提取失败");
    } finally {
      setLoading(false);
    }
  };

  const selectExtractItem = (item: ExtractBatchItem, index: number) => {
    setSelectedExtractIndex(index);
    if (item.status === "success") {
      setJobId(item.jobId);
      setExtractResult(item.extracted);
      setRewrittenText("");
    }
  };

  const handleRewrite = async () => {
    if (!jobId) {
      return;
    }
    setError("");
    setLoading(true);
    try {
      const response = await request<RewriteResponse>("/api/v1/rewrite", {
        method: "POST",
        body: JSON.stringify({
          jobId,
          mode: rewriteMode,
          promptExtra: promptExtra.trim() || undefined,
          provider
        })
      });
      setRewrittenText(response.rewrittenText);
      await refreshJobs();
    } catch (err) {
      setError(err instanceof Error ? err.message : "改写失败");
    } finally {
      setLoading(false);
    }
  };

  const handleExport = async (format: ExportFormat) => {
    if (!jobId) {
      return;
    }
    setError("");
    setLoading(true);
    try {
      const response = await request<ExportResponse>("/api/v1/export", {
        method: "POST",
        body: JSON.stringify({ jobId, format })
      });
      window.open(`${API_BASE}${response.downloadUrl}`, "_blank");
      await refreshJobs();
    } catch (err) {
      setError(err instanceof Error ? err.message : "导出失败");
    } finally {
      setLoading(false);
    }
  };

  const loadFromHistory = (job: JobWithExports) => {
    setJobId(job.id);
    setExtractResult(job.extracted);
    setRewrittenText(job.rewrittenText ?? "");
    setRewriteMode(job.rewriteMode ?? "conservative");
    setExtractItems([]);
    setSelectedExtractIndex(null);
    setIsHistoryOpen(false);
  };

  return (
    <div className="page">
      <header className="hero">
        <div className="hero-content">
          <h1>AutoExtraction V1</h1>
          <p>输入网页地址，一键完成提取、洗稿与文档导出。</p>
        </div>
        <button className="history-btn" onClick={() => setIsHistoryOpen(true)}>
          <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10"></circle>
            <polyline points="12 6 12 12 16 14"></polyline>
          </svg>
          历史记录
        </button>
      </header>

      {error ? <div className="error">{error}</div> : null}

      <div className="main-grid-layout">
        <div className="left-col">
          <section className="card">
            <h2>1. URL 输入与提取</h2>
            <label className="url-input-label">
              批量 URL（支持换行、空格、英文逗号或中文逗号分隔）
              <textarea
                className="url-batch-input"
                value={urlInput}
                onChange={(event) => setUrlInput(event.target.value)}
                placeholder="https://example.com/a\nhttps://example.com/b"
                rows={6}
              />
            </label>
            <div className="row">
              <p className={`batch-count ${overBatchLimit ? "batch-count-error" : ""}`}>
                已识别 {parsedUrls.length} 条 URL（上限 {MAX_BATCH_URLS}）
              </p>
              <button disabled={loading || !canExtract} onClick={handleExtract}>
                {loading ? "处理中..." : "开始提取"}
              </button>
            </div>
          </section>

          <section className="card flex-1-card">
            <h2>2. 提取结果预览</h2>
            {extractItems.length > 0 ? (
              <div className="extract-panel">
                <div className="extract-list" role="listbox" aria-label="批量提取结果列表">
                  {extractItems.map((item, index) => {
                    const isActive = selectedExtractIndex === index;
                    return (
                      <button
                        key={`${item.inputUrl}-${index}`}
                        className={`extract-item ${isActive ? "active" : ""} ${item.status === "failed" ? "failed" : ""}`}
                        onClick={() => selectExtractItem(item, index)}
                      >
                        <div className="extract-item-title">
                          {item.status === "success"
                            ? item.extracted.title || item.url
                            : item.inputUrl}
                        </div>
                        <div className="extract-item-meta">
                          {item.status === "success" ? (
                            <>
                              <span className="status-success">成功</span>
                              <span className="truncate">{item.url}</span>
                            </>
                          ) : (
                            <>
                              <span className="status-failed">失败</span>
                              <span className="truncate">{item.error}</span>
                            </>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
                <div className="extract-detail">
                  {selectedExtractItem ? (
                    selectedExtractItem.status === "success" ? (
                      <div className="result-container">
                        <h3>{selectedExtractItem.extracted.title}</h3>
                        <p className="meta">{selectedExtractItem.extracted.meta.sourceUrl}</p>
                        <textarea className="flex-1-textarea" value={selectedExtractItem.extracted.contentMarkdown} readOnly />
                      </div>
                    ) : (
                      <div className="failed-detail">
                        <p className="hint">该 URL 提取失败</p>
                        <p className="meta">{selectedExtractItem.inputUrl}</p>
                        <p className="failed-text">{selectedExtractItem.error}</p>
                      </div>
                    )
                  ) : (
                    <p className="hint">请选择一条结果查看详情</p>
                  )}
                </div>
              </div>
            ) : extractResult ? (
              <div className="result-container">
                <h3>{extractResult.title}</h3>
                <p className="meta">{extractResult.meta.sourceUrl}</p>
                <textarea className="flex-1-textarea" value={extractResult.contentMarkdown} readOnly />
              </div>
            ) : (
              <p className="hint">暂无提取结果</p>
            )}
          </section>
        </div>

        <div className="right-col">
          <section className="card flex-1-card">
            <h2>3. 改写参数与结果</h2>
            <div className="grid-2">
              <label>
                API Base URL
                <input
                  value={provider.baseUrl}
                  onChange={(event) => setProvider({ ...provider, baseUrl: event.target.value })}
                />
              </label>
              <label>
                模型
                <input
                  value={provider.model}
                  onChange={(event) => setProvider({ ...provider, model: event.target.value })}
                />
              </label>
            </div>
            <label>
              API Key
              <input
                type="password"
                value={provider.apiKey}
                onChange={(event) => setProvider({ ...provider, apiKey: event.target.value })}
                placeholder="本地明文保存由你自行管理"
              />
            </label>
            <div className="row">
              <select value={rewriteMode} onChange={(event) => setRewriteMode(event.target.value as RewriteMode)}>
                <option value="conservative">保守改写</option>
                <option value="aggressive">深度改写</option>
              </select>
              <button disabled={loading || !canRewrite} onClick={handleRewrite}>
                执行改写
              </button>
            </div>
            <label className="mt-4">
              附加要求（可选）
              <textarea value={promptExtra} onChange={(event) => setPromptExtra(event.target.value)} rows={2} />
            </label>
            <label className="flex-1-label mt-4">
              改写结果
              <textarea className="flex-1-textarea" value={rewrittenText} onChange={(event) => setRewrittenText(event.target.value)} />
            </label>
          </section>

          <section className="card">
            <h2>4. 导出下载</h2>
            <div className="row">
              <button disabled={loading || !canExport} onClick={() => handleExport("docx")}>
                导出 Word
              </button>
              <button disabled={loading || !canExport} onClick={() => handleExport("pptx")}>
                导出 PPT
              </button>
              <button disabled={loading || !canExport} onClick={() => handleExport("pdf")}>
                导出 PDF
              </button>
            </div>
          </section>
        </div>
      </div>

      {isHistoryOpen && (
        <div className="modal-overlay" onClick={() => setIsHistoryOpen(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>历史任务</h2>
              <button className="close-btn" onClick={() => setIsHistoryOpen(false)}>✕</button>
            </div>
            {sortedHistory.length === 0 ? (
              <p className="hint">暂无历史记录</p>
            ) : (
              <ul className="history">
                {sortedHistory.map((item) => (
                  <li key={item.id}>
                    <button className="link-btn" title={item.extracted?.title || item.url} onClick={() => loadFromHistory(item)}>
                      {item.extracted?.title || item.url}
                    </button>
                    <div className="history-meta">
                      <span>{new Date(item.createdAt).toLocaleString()}</span>
                      <div className="history-exports">
                        {item.exports?.map((exported) => (
                          <a key={exported.fileId} href={`${API_BASE}${exported.downloadUrl}`} target="_blank" rel="noreferrer">
                            {exported.format}
                          </a>
                        ))}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
