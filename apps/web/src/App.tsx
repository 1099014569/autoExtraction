import { useEffect, useMemo, useState } from "react";
import type {
  ExportBatchResponse,
  ExportFormat,
  ExportResponse,
  ExtractBatchItem,
  ExtractBatchResponse,
  Job,
  ProviderConfig,
  RewriteBatchResponse,
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

const statusLabel = {
  ready: "待改写",
  rewritten: "已改写",
  failed: "提取失败"
} as const;

const App = () => {
  const [urlInput, setUrlInput] = useState("");
  const [extractItems, setExtractItems] = useState<ExtractBatchItem[]>([]);
  const [selectedExtractIndex, setSelectedExtractIndex] = useState<number | null>(null);
  const [checkedJobIds, setCheckedJobIds] = useState<Set<string>>(new Set());
  const [rewrittenByJobId, setRewrittenByJobId] = useState<Record<string, string>>({});
  const [jobId, setJobId] = useState<string | null>(null);
  const [extractResult, setExtractResult] = useState<Job["extracted"] | null>(null);
  const [rewrittenText, setRewrittenText] = useState("");
  const [rewriteMode, setRewriteMode] = useState<RewriteMode>("conservative");
  const [promptExtra, setPromptExtra] = useState("");
  const [loadingLabel, setLoadingLabel] = useState("");
  const [history, setHistory] = useState<JobWithExports[]>([]);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [provider, setProvider] = useState<ProviderConfig>(DEFAULT_PROVIDER);
  const [error, setError] = useState("");
  const [localStateReady, setLocalStateReady] = useState(false);
  const [ignoreRobots, setIgnoreRobots] = useState(false);

  const parsedUrls = useMemo(() => parseUrlsFromInput(urlInput), [urlInput]);
  const overBatchLimit = parsedUrls.length > MAX_BATCH_URLS;
  const canExtract = parsedUrls.length > 0 && !overBatchLimit;

  const sortedHistory = useMemo(
    () => [...history].sort((a, b) => b.createdAt - a.createdAt),
    [history]
  );

  const selectedExtractItem =
    selectedExtractIndex === null ? null : (extractItems[selectedExtractIndex] ?? null);

  const successfulItems = extractItems.filter((item) => item.status === "success");
  const selectedJobIds = successfulItems
    .map((item) => item.jobId)
    .filter((id) => checkedJobIds.has(id));

  const canRewrite = Boolean(jobId && extractResult);
  const canExport = Boolean(jobId && rewrittenText.trim());
  const canBatchRewrite = selectedJobIds.length > 0;
  const canBatchExport = selectedJobIds.length > 0;
  const isBusy = Boolean(loadingLabel);

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

  const selectSuccessItem = (item: ExtractBatchItem & { status: "success" }, index: number) => {
    setSelectedExtractIndex(index);
    setJobId(item.jobId);
    setExtractResult(item.extracted);
    setRewrittenText(rewrittenByJobId[item.jobId] ?? "");
  };

  const handleExtract = async () => {
    if (!canExtract) {
      if (overBatchLimit) {
        setError(`单次最多支持 ${MAX_BATCH_URLS} 条 URL`);
      }
      return;
    }

    setError("");
    setLoadingLabel("提取中");
    try {
      const response = await request<ExtractBatchResponse>("/api/v1/extract/batch", {
        method: "POST",
        body: JSON.stringify({ urls: parsedUrls, ignoreRobots })
      });
      setExtractItems(response.items);
      setRewrittenByJobId({});

      const successIds = response.items
        .filter((item): item is ExtractBatchItem & { status: "success" } => item.status === "success")
        .map((item) => item.jobId);
      setCheckedJobIds(new Set(successIds));

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
      setLoadingLabel("");
    }
  };

  const handleRewrite = async () => {
    if (!jobId) {
      return;
    }
    setError("");
    setLoadingLabel("改写中");
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
      setRewrittenByJobId((current) => ({ ...current, [jobId]: response.rewrittenText }));
      await refreshJobs();
    } catch (err) {
      setError(err instanceof Error ? err.message : "改写失败");
    } finally {
      setLoadingLabel("");
    }
  };

  const handleBatchRewrite = async () => {
    if (!canBatchRewrite) {
      return;
    }
    setError("");
    setLoadingLabel("批量改写中");
    try {
      const response = await request<RewriteBatchResponse>("/api/v1/rewrite/batch", {
        method: "POST",
        body: JSON.stringify({
          jobIds: selectedJobIds,
          mode: rewriteMode,
          promptExtra: promptExtra.trim() || undefined,
          provider
        })
      });

      const nextTexts: Record<string, string> = {};
      for (const item of response.items) {
        if (item.status === "success") {
          nextTexts[item.jobId] = item.rewrittenText;
        }
      }
      setRewrittenByJobId((current) => ({ ...current, ...nextTexts }));
      if (jobId && nextTexts[jobId]) {
        setRewrittenText(nextTexts[jobId]);
      }
      await refreshJobs();
    } catch (err) {
      setError(err instanceof Error ? err.message : "批量改写失败");
    } finally {
      setLoadingLabel("");
    }
  };

  const handleExport = async (format: ExportFormat) => {
    if (!jobId) {
      return;
    }
    setError("");
    setLoadingLabel("导出中");
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
      setLoadingLabel("");
    }
  };

  const handleBatchExport = async (format: ExportFormat) => {
    if (!canBatchExport) {
      return;
    }
    setError("");
    setLoadingLabel("批量导出中");
    try {
      const response = await request<ExportBatchResponse>("/api/v1/export/batch", {
        method: "POST",
        body: JSON.stringify({ jobIds: selectedJobIds, format })
      });
      const firstSuccess = response.items.find((item) => item.status === "success");
      if (firstSuccess?.status === "success") {
        window.open(`${API_BASE}${firstSuccess.downloadUrl}`, "_blank");
      }
      await refreshJobs();
    } catch (err) {
      setError(err instanceof Error ? err.message : "批量导出失败");
    } finally {
      setLoadingLabel("");
    }
  };

  const loadFromHistory = (job: JobWithExports) => {
    setJobId(job.id);
    setExtractResult(job.extracted);
    setRewrittenText(job.rewrittenText ?? "");
    setRewriteMode(job.rewriteMode ?? "conservative");
    setExtractItems([]);
    setCheckedJobIds(new Set());
    setSelectedExtractIndex(null);
    setIsHistoryOpen(false);
  };

  const toggleChecked = (id: string) => {
    setCheckedJobIds((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const selectAll = () => {
    setCheckedJobIds(new Set(successfulItems.map((item) => item.jobId)));
  };

  const clearAll = () => {
    setCheckedJobIds(new Set());
  };

  const currentTitle = extractResult?.title || "任务详情";
  const currentUrl = extractResult?.meta.sourceUrl || "";
  const currentStatus = rewrittenText.trim() ? "rewritten" : "ready";

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">AutoExtraction V1</p>
          <h1>批量任务工作台</h1>
        </div>
        <div className="topbar-actions">
          {loadingLabel ? <span className="busy-indicator">{loadingLabel}</span> : null}
          <button className="ghost-button" onClick={() => setIsHistoryOpen(true)}>
            历史记录
          </button>
          <button className="ghost-button" onClick={() => setIsSettingsOpen(true)}>
            设置
          </button>
        </div>
      </header>

      {error ? <div className="notice error-notice">{error}</div> : null}

      <section className="command-panel">
        <label className="url-box">
          <span>粘贴网页链接</span>
          <textarea
            value={urlInput}
            onChange={(event) => setUrlInput(event.target.value)}
            placeholder="每行一个 URL，也支持空格或逗号分隔"
            rows={3}
          />
        </label>
        <div className="command-actions">
          <div className={`input-meta ${overBatchLimit ? "danger-text" : ""}`}>
            <strong>{parsedUrls.length}</strong> / {MAX_BATCH_URLS} 个链接
          </div>
          <label className="inline-checkbox">
            <input
              type="checkbox"
              checked={ignoreRobots}
              onChange={(e) => setIgnoreRobots(e.target.checked)}
            />
            忽略 robots.txt 限制
          </label>
          <button className="primary-button" disabled={isBusy || !canExtract} onClick={handleExtract}>
            开始提取
          </button>
          <button disabled={isBusy || !canBatchRewrite} onClick={handleBatchRewrite}>
            批量改写
          </button>
          <div className="export-buttons" aria-label="批量导出">
            <button disabled={isBusy || !canBatchExport} onClick={() => handleBatchExport("docx")}>
              Word
            </button>
            <button disabled={isBusy || !canBatchExport} onClick={() => handleBatchExport("pptx")}>
              PPT
            </button>
            <button disabled={isBusy || !canBatchExport} onClick={() => handleBatchExport("pdf")}>
              PDF
            </button>
          </div>
        </div>
      </section>

      <main className="workspace">
        <aside className="queue-panel">
          <div className="panel-header">
            <div>
              <h2>任务队列</h2>
              <p>{selectedJobIds.length} 个已勾选</p>
            </div>
            <div className="mini-actions">
              <button className="text-button" onClick={selectAll} disabled={successfulItems.length === 0}>
                全选
              </button>
              <button className="text-button" onClick={clearAll} disabled={checkedJobIds.size === 0}>
                清空
              </button>
            </div>
          </div>

          {extractItems.length === 0 ? (
            <p className="empty-state">暂无任务，请先粘贴链接并开始提取</p>
          ) : (
            <div className="queue-list">
              {extractItems.map((item, index) => {
                const isActive = selectedExtractIndex === index;
                const isSuccess = item.status === "success";
                const title = isSuccess ? item.extracted.title || item.url : item.inputUrl;
                const url = isSuccess ? item.url : item.error;
                const itemStatus = isSuccess
                  ? rewrittenByJobId[item.jobId] || (jobId === item.jobId && rewrittenText.trim())
                    ? "rewritten"
                    : "ready"
                  : "failed";

                return (
                  <div
                    key={`${item.inputUrl}-${index}`}
                    role="button"
                    tabIndex={0}
                    className={`queue-item ${isActive ? "active" : ""}`}
                    onClick={() => {
                      if (item.status === "success") {
                        selectSuccessItem(item, index);
                      } else {
                        setSelectedExtractIndex(index);
                        setJobId(null);
                        setExtractResult(null);
                        setRewrittenText("");
                      }
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        if (item.status === "success") {
                          selectSuccessItem(item, index);
                        }
                      }
                    }}
                  >
                    <input
                      type="checkbox"
                      aria-label="选择任务"
                      checked={isSuccess && checkedJobIds.has(item.jobId)}
                      disabled={!isSuccess}
                      onChange={() => {
                        if (isSuccess) {
                          toggleChecked(item.jobId);
                        }
                      }}
                      onClick={(event) => event.stopPropagation()}
                    />
                    <div className="queue-content">
                      <div className="queue-title">{title}</div>
                      <div className="queue-url">{url}</div>
                      {!isSuccess ? <div className="item-error">{item.error}</div> : null}
                    </div>
                    <span className={`status-badge status-${itemStatus}`}>
                      {statusLabel[itemStatus]}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </aside>

        <section className="detail-panel">
          {extractResult ? (
            <>
              <div className="panel-header detail-header">
                <div>
                  <h2>{currentTitle}</h2>
                  <p>{currentUrl}</p>
                </div>
                <span className={`status-badge status-${currentStatus}`}>{statusLabel[currentStatus]}</span>
              </div>
              <div className="preview-grid">
                <label className="content-column">
                  <span>提取内容</span>
                  <textarea value={extractResult.contentMarkdown} readOnly placeholder="提取完成后显示正文" />
                </label>
                <label className="content-column">
                  <span>改写结果</span>
                  <textarea
                    value={rewrittenText}
                    onChange={(event) => setRewrittenText(event.target.value)}
                    placeholder="改写完成后显示结果，也可以手动编辑"
                  />
                </label>
              </div>
              <div className="detail-actions">
                <button className="primary-button" disabled={isBusy || !canRewrite} onClick={handleRewrite}>
                  执行改写
                </button>
                <button disabled={isBusy || !canExport} onClick={() => handleExport("docx")}>
                  导出 Word
                </button>
                <button disabled={isBusy || !canExport} onClick={() => handleExport("pptx")}>
                  导出 PPT
                </button>
                <button disabled={isBusy || !canExport} onClick={() => handleExport("pdf")}>
                  导出 PDF
                </button>
              </div>
            </>
          ) : selectedExtractItem?.status === "failed" ? (
            <div className="empty-state large">
              <strong>该 URL 提取失败</strong>
              <p>{selectedExtractItem.inputUrl}</p>
              <p className="danger-text">{selectedExtractItem.error}</p>
            </div>
          ) : (
            <p className="empty-state large">请选择任务查看详情</p>
          )}
        </section>
      </main>

      {isSettingsOpen ? (
        <div className="drawer-backdrop" onClick={() => setIsSettingsOpen(false)}>
          <aside className="settings-drawer" onClick={(event) => event.stopPropagation()}>
            <div className="drawer-header">
              <div>
                <h2>改写设置</h2>
                <p>配置模型、模式与附加要求</p>
              </div>
              <button className="icon-button" onClick={() => setIsSettingsOpen(false)}>
                ×
              </button>
            </div>
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
            <label>
              API Key
              <input
                type="password"
                value={provider.apiKey}
                onChange={(event) => setProvider({ ...provider, apiKey: event.target.value })}
                placeholder="本地明文保存由你自行管理"
              />
            </label>
            <label>
              改写模式
              <select value={rewriteMode} onChange={(event) => setRewriteMode(event.target.value as RewriteMode)}>
                <option value="conservative">保守改写</option>
                <option value="aggressive">深度改写</option>
              </select>
            </label>
            <label>
              附加要求
              <textarea value={promptExtra} onChange={(event) => setPromptExtra(event.target.value)} rows={4} />
            </label>
          </aside>
        </div>
      ) : null}

      {isHistoryOpen ? (
        <div className="drawer-backdrop" onClick={() => setIsHistoryOpen(false)}>
          <aside className="history-drawer" onClick={(event) => event.stopPropagation()}>
            <div className="drawer-header">
              <div>
                <h2>历史记录</h2>
                <p>最近保存的任务</p>
              </div>
              <button className="icon-button" onClick={() => setIsHistoryOpen(false)}>
                ×
              </button>
            </div>
            {sortedHistory.length === 0 ? (
              <p className="empty-state">暂无历史记录</p>
            ) : (
              <div className="history-list">
                {sortedHistory.map((item) => (
                  <button className="history-item" key={item.id} onClick={() => loadFromHistory(item)}>
                    <span>{item.extracted?.title || item.url}</span>
                    <small>{new Date(item.createdAt).toLocaleString()}</small>
                    {item.exports?.length ? (
                      <div className="download-links">
                        {item.exports.map((exported) => (
                          <a
                            key={exported.fileId}
                            href={`${API_BASE}${exported.downloadUrl}`}
                            target="_blank"
                            rel="noreferrer"
                            onClick={(event) => event.stopPropagation()}
                          >
                            {exported.format}
                          </a>
                        ))}
                      </div>
                    ) : null}
                  </button>
                ))}
              </div>
            )}
          </aside>
        </div>
      ) : null}
    </div>
  );
};

export default App;
