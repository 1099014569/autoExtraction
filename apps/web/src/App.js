import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useMemo, useState } from "react";
const API_BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:8787";
const MAX_BATCH_URLS = 20;
const LOCAL_STATE_SAVE_DEBOUNCE_MS = 500;
const DEFAULT_PROVIDER = {
    baseUrl: "https://api.openai.com/v1",
    apiKey: "",
    model: "gpt-4o-mini"
};
const parseUrlsFromInput = (value) => value
    .split(/[\s,，]+/)
    .map((item) => item.trim())
    .filter(Boolean);
const statusLabel = {
    ready: "待改写",
    rewritten: "已改写",
    failed: "提取失败"
};
const App = () => {
    const [urlInput, setUrlInput] = useState("");
    const [extractItems, setExtractItems] = useState([]);
    const [selectedExtractIndex, setSelectedExtractIndex] = useState(null);
    const [checkedJobIds, setCheckedJobIds] = useState(new Set());
    const [rewrittenByJobId, setRewrittenByJobId] = useState({});
    const [jobId, setJobId] = useState(null);
    const [extractResult, setExtractResult] = useState(null);
    const [rewrittenText, setRewrittenText] = useState("");
    const [rewriteMode, setRewriteMode] = useState("conservative");
    const [promptExtra, setPromptExtra] = useState("");
    const [loadingLabel, setLoadingLabel] = useState("");
    const [history, setHistory] = useState([]);
    const [isHistoryOpen, setIsHistoryOpen] = useState(false);
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    const [provider, setProvider] = useState(DEFAULT_PROVIDER);
    const [error, setError] = useState("");
    const [localStateReady, setLocalStateReady] = useState(false);
    const parsedUrls = useMemo(() => parseUrlsFromInput(urlInput), [urlInput]);
    const overBatchLimit = parsedUrls.length > MAX_BATCH_URLS;
    const canExtract = parsedUrls.length > 0 && !overBatchLimit;
    const sortedHistory = useMemo(() => [...history].sort((a, b) => b.createdAt - a.createdAt), [history]);
    const selectedExtractItem = selectedExtractIndex === null ? null : (extractItems[selectedExtractIndex] ?? null);
    const successfulItems = extractItems.filter((item) => item.status === "success");
    const selectedJobIds = successfulItems
        .map((item) => item.jobId)
        .filter((id) => checkedJobIds.has(id));
    const canRewrite = Boolean(jobId && extractResult);
    const canExport = Boolean(jobId && rewrittenText.trim());
    const canBatchRewrite = selectedJobIds.length > 0;
    const canBatchExport = selectedJobIds.length > 0;
    const isBusy = Boolean(loadingLabel);
    const request = async (path, init) => {
        const response = await fetch(`${API_BASE}${path}`, {
            ...init,
            headers: {
                "content-type": "application/json",
                ...(init?.headers ?? {})
            }
        });
        const body = (await response.json());
        if (!response.ok) {
            throw new Error(body.message ?? "请求失败");
        }
        return body;
    };
    const refreshJobs = async () => {
        const jobsData = await request("/api/v1/jobs?limit=100");
        setHistory(jobsData.jobs);
    };
    const loadRewriteLocalState = async () => {
        try {
            const state = await request("/api/v1/rewrite-local-state");
            setProvider(state.provider);
            setRewriteMode(state.rewriteMode);
            setPromptExtra(state.promptExtra);
            setRewrittenText(state.rewrittenText);
        }
        catch {
            // 本地状态加载失败时回退到默认值，避免阻断主流程。
        }
        finally {
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
            void request("/api/v1/rewrite-local-state", {
                method: "PUT",
                body: JSON.stringify({
                    provider,
                    rewriteMode,
                    promptExtra,
                    rewrittenText
                })
            });
        }, LOCAL_STATE_SAVE_DEBOUNCE_MS);
        return () => {
            window.clearTimeout(timer);
        };
    }, [provider, rewriteMode, promptExtra, rewrittenText, localStateReady]);
    const selectSuccessItem = (item, index) => {
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
            const response = await request("/api/v1/extract/batch", {
                method: "POST",
                body: JSON.stringify({ urls: parsedUrls })
            });
            setExtractItems(response.items);
            setRewrittenByJobId({});
            const successIds = response.items
                .filter((item) => item.status === "success")
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
            }
            else {
                setSelectedExtractIndex(response.items.length > 0 ? 0 : null);
                setJobId(null);
                setExtractResult(null);
                setRewrittenText("");
            }
            await refreshJobs();
        }
        catch (err) {
            setError(err instanceof Error ? err.message : "提取失败");
        }
        finally {
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
            const response = await request("/api/v1/rewrite", {
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
        }
        catch (err) {
            setError(err instanceof Error ? err.message : "改写失败");
        }
        finally {
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
            const response = await request("/api/v1/rewrite/batch", {
                method: "POST",
                body: JSON.stringify({
                    jobIds: selectedJobIds,
                    mode: rewriteMode,
                    promptExtra: promptExtra.trim() || undefined,
                    provider
                })
            });
            const nextTexts = {};
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
        }
        catch (err) {
            setError(err instanceof Error ? err.message : "批量改写失败");
        }
        finally {
            setLoadingLabel("");
        }
    };
    const handleExport = async (format) => {
        if (!jobId) {
            return;
        }
        setError("");
        setLoadingLabel("导出中");
        try {
            const response = await request("/api/v1/export", {
                method: "POST",
                body: JSON.stringify({ jobId, format })
            });
            window.open(`${API_BASE}${response.downloadUrl}`, "_blank");
            await refreshJobs();
        }
        catch (err) {
            setError(err instanceof Error ? err.message : "导出失败");
        }
        finally {
            setLoadingLabel("");
        }
    };
    const handleBatchExport = async (format) => {
        if (!canBatchExport) {
            return;
        }
        setError("");
        setLoadingLabel("批量导出中");
        try {
            const response = await request("/api/v1/export/batch", {
                method: "POST",
                body: JSON.stringify({ jobIds: selectedJobIds, format })
            });
            const firstSuccess = response.items.find((item) => item.status === "success");
            if (firstSuccess?.status === "success") {
                window.open(`${API_BASE}${firstSuccess.downloadUrl}`, "_blank");
            }
            await refreshJobs();
        }
        catch (err) {
            setError(err instanceof Error ? err.message : "批量导出失败");
        }
        finally {
            setLoadingLabel("");
        }
    };
    const loadFromHistory = (job) => {
        setJobId(job.id);
        setExtractResult(job.extracted);
        setRewrittenText(job.rewrittenText ?? "");
        setRewriteMode(job.rewriteMode ?? "conservative");
        setExtractItems([]);
        setCheckedJobIds(new Set());
        setSelectedExtractIndex(null);
        setIsHistoryOpen(false);
    };
    const toggleChecked = (id) => {
        setCheckedJobIds((current) => {
            const next = new Set(current);
            if (next.has(id)) {
                next.delete(id);
            }
            else {
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
    return (_jsxs("div", { className: "app-shell", children: [_jsxs("header", { className: "topbar", children: [_jsxs("div", { children: [_jsx("p", { className: "eyebrow", children: "AutoExtraction V1" }), _jsx("h1", { children: "\u6279\u91CF\u4EFB\u52A1\u5DE5\u4F5C\u53F0" })] }), _jsxs("div", { className: "topbar-actions", children: [loadingLabel ? _jsx("span", { className: "busy-indicator", children: loadingLabel }) : null, _jsx("button", { className: "ghost-button", onClick: () => setIsHistoryOpen(true), children: "\u5386\u53F2\u8BB0\u5F55" }), _jsx("button", { className: "ghost-button", onClick: () => setIsSettingsOpen(true), children: "\u8BBE\u7F6E" })] })] }), error ? _jsx("div", { className: "notice error-notice", children: error }) : null, _jsxs("section", { className: "command-panel", children: [_jsxs("label", { className: "url-box", children: [_jsx("span", { children: "\u7C98\u8D34\u7F51\u9875\u94FE\u63A5" }), _jsx("textarea", { value: urlInput, onChange: (event) => setUrlInput(event.target.value), placeholder: "\u6BCF\u884C\u4E00\u4E2A URL\uFF0C\u4E5F\u652F\u6301\u7A7A\u683C\u6216\u9017\u53F7\u5206\u9694", rows: 3 })] }), _jsxs("div", { className: "command-actions", children: [_jsxs("div", { className: `input-meta ${overBatchLimit ? "danger-text" : ""}`, children: [_jsx("strong", { children: parsedUrls.length }), " / ", MAX_BATCH_URLS, " \u4E2A\u94FE\u63A5"] }), _jsx("button", { className: "primary-button", disabled: isBusy || !canExtract, onClick: handleExtract, children: "\u5F00\u59CB\u63D0\u53D6" }), _jsx("button", { disabled: isBusy || !canBatchRewrite, onClick: handleBatchRewrite, children: "\u6279\u91CF\u6539\u5199" }), _jsxs("div", { className: "export-buttons", "aria-label": "\u6279\u91CF\u5BFC\u51FA", children: [_jsx("button", { disabled: isBusy || !canBatchExport, onClick: () => handleBatchExport("docx"), children: "Word" }), _jsx("button", { disabled: isBusy || !canBatchExport, onClick: () => handleBatchExport("pptx"), children: "PPT" }), _jsx("button", { disabled: isBusy || !canBatchExport, onClick: () => handleBatchExport("pdf"), children: "PDF" })] })] })] }), _jsxs("main", { className: "workspace", children: [_jsxs("aside", { className: "queue-panel", children: [_jsxs("div", { className: "panel-header", children: [_jsxs("div", { children: [_jsx("h2", { children: "\u4EFB\u52A1\u961F\u5217" }), _jsxs("p", { children: [selectedJobIds.length, " \u4E2A\u5DF2\u52FE\u9009"] })] }), _jsxs("div", { className: "mini-actions", children: [_jsx("button", { className: "text-button", onClick: selectAll, disabled: successfulItems.length === 0, children: "\u5168\u9009" }), _jsx("button", { className: "text-button", onClick: clearAll, disabled: checkedJobIds.size === 0, children: "\u6E05\u7A7A" })] })] }), extractItems.length === 0 ? (_jsx("p", { className: "empty-state", children: "\u6682\u65E0\u4EFB\u52A1\uFF0C\u8BF7\u5148\u7C98\u8D34\u94FE\u63A5\u5E76\u5F00\u59CB\u63D0\u53D6" })) : (_jsx("div", { className: "queue-list", children: extractItems.map((item, index) => {
                                    const isActive = selectedExtractIndex === index;
                                    const isSuccess = item.status === "success";
                                    const title = isSuccess ? item.extracted.title || item.url : item.inputUrl;
                                    const url = isSuccess ? item.url : item.error;
                                    const itemStatus = isSuccess
                                        ? rewrittenByJobId[item.jobId] || (jobId === item.jobId && rewrittenText.trim())
                                            ? "rewritten"
                                            : "ready"
                                        : "failed";
                                    return (_jsxs("div", { role: "button", tabIndex: 0, className: `queue-item ${isActive ? "active" : ""}`, onClick: () => {
                                            if (item.status === "success") {
                                                selectSuccessItem(item, index);
                                            }
                                            else {
                                                setSelectedExtractIndex(index);
                                                setJobId(null);
                                                setExtractResult(null);
                                                setRewrittenText("");
                                            }
                                        }, onKeyDown: (event) => {
                                            if (event.key === "Enter" || event.key === " ") {
                                                event.preventDefault();
                                                if (item.status === "success") {
                                                    selectSuccessItem(item, index);
                                                }
                                            }
                                        }, children: [_jsx("input", { type: "checkbox", "aria-label": "\u9009\u62E9\u4EFB\u52A1", checked: isSuccess && checkedJobIds.has(item.jobId), disabled: !isSuccess, onChange: () => {
                                                    if (isSuccess) {
                                                        toggleChecked(item.jobId);
                                                    }
                                                }, onClick: (event) => event.stopPropagation() }), _jsxs("div", { className: "queue-content", children: [_jsx("div", { className: "queue-title", children: title }), _jsx("div", { className: "queue-url", children: url }), !isSuccess ? _jsx("div", { className: "item-error", children: item.error }) : null] }), _jsx("span", { className: `status-badge status-${itemStatus}`, children: statusLabel[itemStatus] })] }, `${item.inputUrl}-${index}`));
                                }) }))] }), _jsx("section", { className: "detail-panel", children: extractResult ? (_jsxs(_Fragment, { children: [_jsxs("div", { className: "panel-header detail-header", children: [_jsxs("div", { children: [_jsx("h2", { children: currentTitle }), _jsx("p", { children: currentUrl })] }), _jsx("span", { className: `status-badge status-${currentStatus}`, children: statusLabel[currentStatus] })] }), _jsxs("div", { className: "preview-grid", children: [_jsxs("label", { className: "content-column", children: [_jsx("span", { children: "\u63D0\u53D6\u5185\u5BB9" }), _jsx("textarea", { value: extractResult.contentMarkdown, readOnly: true, placeholder: "\u63D0\u53D6\u5B8C\u6210\u540E\u663E\u793A\u6B63\u6587" })] }), _jsxs("label", { className: "content-column", children: [_jsx("span", { children: "\u6539\u5199\u7ED3\u679C" }), _jsx("textarea", { value: rewrittenText, onChange: (event) => setRewrittenText(event.target.value), placeholder: "\u6539\u5199\u5B8C\u6210\u540E\u663E\u793A\u7ED3\u679C\uFF0C\u4E5F\u53EF\u4EE5\u624B\u52A8\u7F16\u8F91" })] })] }), _jsxs("div", { className: "detail-actions", children: [_jsx("button", { className: "primary-button", disabled: isBusy || !canRewrite, onClick: handleRewrite, children: "\u6267\u884C\u6539\u5199" }), _jsx("button", { disabled: isBusy || !canExport, onClick: () => handleExport("docx"), children: "\u5BFC\u51FA Word" }), _jsx("button", { disabled: isBusy || !canExport, onClick: () => handleExport("pptx"), children: "\u5BFC\u51FA PPT" }), _jsx("button", { disabled: isBusy || !canExport, onClick: () => handleExport("pdf"), children: "\u5BFC\u51FA PDF" })] })] })) : selectedExtractItem?.status === "failed" ? (_jsxs("div", { className: "empty-state large", children: [_jsx("strong", { children: "\u8BE5 URL \u63D0\u53D6\u5931\u8D25" }), _jsx("p", { children: selectedExtractItem.inputUrl }), _jsx("p", { className: "danger-text", children: selectedExtractItem.error })] })) : (_jsx("p", { className: "empty-state large", children: "\u8BF7\u9009\u62E9\u4EFB\u52A1\u67E5\u770B\u8BE6\u60C5" })) })] }), isSettingsOpen ? (_jsx("div", { className: "drawer-backdrop", onClick: () => setIsSettingsOpen(false), children: _jsxs("aside", { className: "settings-drawer", onClick: (event) => event.stopPropagation(), children: [_jsxs("div", { className: "drawer-header", children: [_jsxs("div", { children: [_jsx("h2", { children: "\u6539\u5199\u8BBE\u7F6E" }), _jsx("p", { children: "\u914D\u7F6E\u6A21\u578B\u3001\u6A21\u5F0F\u4E0E\u9644\u52A0\u8981\u6C42" })] }), _jsx("button", { className: "icon-button", onClick: () => setIsSettingsOpen(false), children: "\u00D7" })] }), _jsxs("label", { children: ["API Base URL", _jsx("input", { value: provider.baseUrl, onChange: (event) => setProvider({ ...provider, baseUrl: event.target.value }) })] }), _jsxs("label", { children: ["\u6A21\u578B", _jsx("input", { value: provider.model, onChange: (event) => setProvider({ ...provider, model: event.target.value }) })] }), _jsxs("label", { children: ["API Key", _jsx("input", { type: "password", value: provider.apiKey, onChange: (event) => setProvider({ ...provider, apiKey: event.target.value }), placeholder: "\u672C\u5730\u660E\u6587\u4FDD\u5B58\u7531\u4F60\u81EA\u884C\u7BA1\u7406" })] }), _jsxs("label", { children: ["\u6539\u5199\u6A21\u5F0F", _jsxs("select", { value: rewriteMode, onChange: (event) => setRewriteMode(event.target.value), children: [_jsx("option", { value: "conservative", children: "\u4FDD\u5B88\u6539\u5199" }), _jsx("option", { value: "aggressive", children: "\u6DF1\u5EA6\u6539\u5199" })] })] }), _jsxs("label", { children: ["\u9644\u52A0\u8981\u6C42", _jsx("textarea", { value: promptExtra, onChange: (event) => setPromptExtra(event.target.value), rows: 4 })] })] }) })) : null, isHistoryOpen ? (_jsx("div", { className: "drawer-backdrop", onClick: () => setIsHistoryOpen(false), children: _jsxs("aside", { className: "history-drawer", onClick: (event) => event.stopPropagation(), children: [_jsxs("div", { className: "drawer-header", children: [_jsxs("div", { children: [_jsx("h2", { children: "\u5386\u53F2\u8BB0\u5F55" }), _jsx("p", { children: "\u6700\u8FD1\u4FDD\u5B58\u7684\u4EFB\u52A1" })] }), _jsx("button", { className: "icon-button", onClick: () => setIsHistoryOpen(false), children: "\u00D7" })] }), sortedHistory.length === 0 ? (_jsx("p", { className: "empty-state", children: "\u6682\u65E0\u5386\u53F2\u8BB0\u5F55" })) : (_jsx("div", { className: "history-list", children: sortedHistory.map((item) => (_jsxs("button", { className: "history-item", onClick: () => loadFromHistory(item), children: [_jsx("span", { children: item.extracted?.title || item.url }), _jsx("small", { children: new Date(item.createdAt).toLocaleString() }), item.exports?.length ? (_jsx("div", { className: "download-links", children: item.exports.map((exported) => (_jsx("a", { href: `${API_BASE}${exported.downloadUrl}`, target: "_blank", rel: "noreferrer", onClick: (event) => event.stopPropagation(), children: exported.format }, exported.fileId))) })) : null] }, item.id))) }))] }) })) : null] }));
};
export default App;
