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
const App = () => {
    const [urlInput, setUrlInput] = useState("");
    const [extractItems, setExtractItems] = useState([]);
    const [selectedExtractIndex, setSelectedExtractIndex] = useState(null);
    const [jobId, setJobId] = useState(null);
    const [extractResult, setExtractResult] = useState(null);
    const [rewrittenText, setRewrittenText] = useState("");
    const [rewriteMode, setRewriteMode] = useState("conservative");
    const [promptExtra, setPromptExtra] = useState("");
    const [loading, setLoading] = useState(false);
    const [history, setHistory] = useState([]);
    const [isHistoryOpen, setIsHistoryOpen] = useState(false);
    const [provider, setProvider] = useState(DEFAULT_PROVIDER);
    const [error, setError] = useState("");
    const [localStateReady, setLocalStateReady] = useState(false);
    const canRewrite = Boolean(jobId && extractResult);
    const canExport = Boolean(jobId && rewrittenText.trim());
    const parsedUrls = useMemo(() => parseUrlsFromInput(urlInput), [urlInput]);
    const overBatchLimit = parsedUrls.length > MAX_BATCH_URLS;
    const canExtract = parsedUrls.length > 0 && !overBatchLimit;
    const sortedHistory = useMemo(() => [...history].sort((a, b) => b.createdAt - a.createdAt), [history]);
    const selectedExtractItem = selectedExtractIndex === null ? null : (extractItems[selectedExtractIndex] ?? null);
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
            const response = await request("/api/v1/extract/batch", {
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
            setLoading(false);
        }
    };
    const selectExtractItem = (item, index) => {
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
            await refreshJobs();
        }
        catch (err) {
            setError(err instanceof Error ? err.message : "改写失败");
        }
        finally {
            setLoading(false);
        }
    };
    const handleExport = async (format) => {
        if (!jobId) {
            return;
        }
        setError("");
        setLoading(true);
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
            setLoading(false);
        }
    };
    const loadFromHistory = (job) => {
        setJobId(job.id);
        setExtractResult(job.extracted);
        setRewrittenText(job.rewrittenText ?? "");
        setRewriteMode(job.rewriteMode ?? "conservative");
        setExtractItems([]);
        setSelectedExtractIndex(null);
        setIsHistoryOpen(false);
    };
    return (_jsxs("div", { className: "page", children: [_jsxs("header", { className: "hero", children: [_jsxs("div", { className: "hero-content", children: [_jsx("h1", { children: "AutoExtraction V1" }), _jsx("p", { children: "\u8F93\u5165\u7F51\u9875\u5730\u5740\uFF0C\u4E00\u952E\u5B8C\u6210\u63D0\u53D6\u3001\u6D17\u7A3F\u4E0E\u6587\u6863\u5BFC\u51FA\u3002" })] }), _jsxs("button", { className: "history-btn", onClick: () => setIsHistoryOpen(true), children: [_jsxs("svg", { viewBox: "0 0 24 24", width: "20", height: "20", stroke: "currentColor", strokeWidth: "2", fill: "none", strokeLinecap: "round", strokeLinejoin: "round", children: [_jsx("circle", { cx: "12", cy: "12", r: "10" }), _jsx("polyline", { points: "12 6 12 12 16 14" })] }), "\u5386\u53F2\u8BB0\u5F55"] })] }), error ? _jsx("div", { className: "error", children: error }) : null, _jsxs("div", { className: "main-grid-layout", children: [_jsxs("div", { className: "left-col", children: [_jsxs("section", { className: "card", children: [_jsx("h2", { children: "1. URL \u8F93\u5165\u4E0E\u63D0\u53D6" }), _jsxs("label", { className: "url-input-label", children: ["\u6279\u91CF URL\uFF08\u652F\u6301\u6362\u884C\u3001\u7A7A\u683C\u3001\u82F1\u6587\u9017\u53F7\u6216\u4E2D\u6587\u9017\u53F7\u5206\u9694\uFF09", _jsx("textarea", { className: "url-batch-input", value: urlInput, onChange: (event) => setUrlInput(event.target.value), placeholder: "https://example.com/a\\nhttps://example.com/b", rows: 6 })] }), _jsxs("div", { className: "row", children: [_jsxs("p", { className: `batch-count ${overBatchLimit ? "batch-count-error" : ""}`, children: ["\u5DF2\u8BC6\u522B ", parsedUrls.length, " \u6761 URL\uFF08\u4E0A\u9650 ", MAX_BATCH_URLS, "\uFF09"] }), _jsx("button", { disabled: loading || !canExtract, onClick: handleExtract, children: loading ? "处理中..." : "开始提取" })] })] }), _jsxs("section", { className: "card flex-1-card", children: [_jsx("h2", { children: "2. \u63D0\u53D6\u7ED3\u679C\u9884\u89C8" }), extractItems.length > 0 ? (_jsxs("div", { className: "extract-panel", children: [_jsx("div", { className: "extract-list", role: "listbox", "aria-label": "\u6279\u91CF\u63D0\u53D6\u7ED3\u679C\u5217\u8868", children: extractItems.map((item, index) => {
                                                    const isActive = selectedExtractIndex === index;
                                                    return (_jsxs("button", { className: `extract-item ${isActive ? "active" : ""} ${item.status === "failed" ? "failed" : ""}`, onClick: () => selectExtractItem(item, index), children: [_jsx("div", { className: "extract-item-title", children: item.status === "success"
                                                                    ? item.extracted.title || item.url
                                                                    : item.inputUrl }), _jsx("div", { className: "extract-item-meta", children: item.status === "success" ? (_jsxs(_Fragment, { children: [_jsx("span", { className: "status-success", children: "\u6210\u529F" }), _jsx("span", { className: "truncate", children: item.url })] })) : (_jsxs(_Fragment, { children: [_jsx("span", { className: "status-failed", children: "\u5931\u8D25" }), _jsx("span", { className: "truncate", children: item.error })] })) })] }, `${item.inputUrl}-${index}`));
                                                }) }), _jsx("div", { className: "extract-detail", children: selectedExtractItem ? (selectedExtractItem.status === "success" ? (_jsxs("div", { className: "result-container", children: [_jsx("h3", { children: selectedExtractItem.extracted.title }), _jsx("p", { className: "meta", children: selectedExtractItem.extracted.meta.sourceUrl }), _jsx("textarea", { className: "flex-1-textarea", value: selectedExtractItem.extracted.contentMarkdown, readOnly: true })] })) : (_jsxs("div", { className: "failed-detail", children: [_jsx("p", { className: "hint", children: "\u8BE5 URL \u63D0\u53D6\u5931\u8D25" }), _jsx("p", { className: "meta", children: selectedExtractItem.inputUrl }), _jsx("p", { className: "failed-text", children: selectedExtractItem.error })] }))) : (_jsx("p", { className: "hint", children: "\u8BF7\u9009\u62E9\u4E00\u6761\u7ED3\u679C\u67E5\u770B\u8BE6\u60C5" })) })] })) : extractResult ? (_jsxs("div", { className: "result-container", children: [_jsx("h3", { children: extractResult.title }), _jsx("p", { className: "meta", children: extractResult.meta.sourceUrl }), _jsx("textarea", { className: "flex-1-textarea", value: extractResult.contentMarkdown, readOnly: true })] })) : (_jsx("p", { className: "hint", children: "\u6682\u65E0\u63D0\u53D6\u7ED3\u679C" }))] })] }), _jsxs("div", { className: "right-col", children: [_jsxs("section", { className: "card flex-1-card", children: [_jsx("h2", { children: "3. \u6539\u5199\u53C2\u6570\u4E0E\u7ED3\u679C" }), _jsxs("div", { className: "grid-2", children: [_jsxs("label", { children: ["API Base URL", _jsx("input", { value: provider.baseUrl, onChange: (event) => setProvider({ ...provider, baseUrl: event.target.value }) })] }), _jsxs("label", { children: ["\u6A21\u578B", _jsx("input", { value: provider.model, onChange: (event) => setProvider({ ...provider, model: event.target.value }) })] })] }), _jsxs("label", { children: ["API Key", _jsx("input", { type: "password", value: provider.apiKey, onChange: (event) => setProvider({ ...provider, apiKey: event.target.value }), placeholder: "\u672C\u5730\u660E\u6587\u4FDD\u5B58\u7531\u4F60\u81EA\u884C\u7BA1\u7406" })] }), _jsxs("div", { className: "row", children: [_jsxs("select", { value: rewriteMode, onChange: (event) => setRewriteMode(event.target.value), children: [_jsx("option", { value: "conservative", children: "\u4FDD\u5B88\u6539\u5199" }), _jsx("option", { value: "aggressive", children: "\u6DF1\u5EA6\u6539\u5199" })] }), _jsx("button", { disabled: loading || !canRewrite, onClick: handleRewrite, children: "\u6267\u884C\u6539\u5199" })] }), _jsxs("label", { className: "mt-4", children: ["\u9644\u52A0\u8981\u6C42\uFF08\u53EF\u9009\uFF09", _jsx("textarea", { value: promptExtra, onChange: (event) => setPromptExtra(event.target.value), rows: 2 })] }), _jsxs("label", { className: "flex-1-label mt-4", children: ["\u6539\u5199\u7ED3\u679C", _jsx("textarea", { className: "flex-1-textarea", value: rewrittenText, onChange: (event) => setRewrittenText(event.target.value) })] })] }), _jsxs("section", { className: "card", children: [_jsx("h2", { children: "4. \u5BFC\u51FA\u4E0B\u8F7D" }), _jsxs("div", { className: "row", children: [_jsx("button", { disabled: loading || !canExport, onClick: () => handleExport("docx"), children: "\u5BFC\u51FA Word" }), _jsx("button", { disabled: loading || !canExport, onClick: () => handleExport("pptx"), children: "\u5BFC\u51FA PPT" }), _jsx("button", { disabled: loading || !canExport, onClick: () => handleExport("pdf"), children: "\u5BFC\u51FA PDF" })] })] })] })] }), isHistoryOpen && (_jsx("div", { className: "modal-overlay", onClick: () => setIsHistoryOpen(false), children: _jsxs("div", { className: "modal-content", onClick: (e) => e.stopPropagation(), children: [_jsxs("div", { className: "modal-header", children: [_jsx("h2", { children: "\u5386\u53F2\u4EFB\u52A1" }), _jsx("button", { className: "close-btn", onClick: () => setIsHistoryOpen(false), children: "\u2715" })] }), sortedHistory.length === 0 ? (_jsx("p", { className: "hint", children: "\u6682\u65E0\u5386\u53F2\u8BB0\u5F55" })) : (_jsx("ul", { className: "history", children: sortedHistory.map((item) => (_jsxs("li", { children: [_jsx("button", { className: "link-btn", title: item.extracted?.title || item.url, onClick: () => loadFromHistory(item), children: item.extracted?.title || item.url }), _jsxs("div", { className: "history-meta", children: [_jsx("span", { children: new Date(item.createdAt).toLocaleString() }), _jsx("div", { className: "history-exports", children: item.exports?.map((exported) => (_jsx("a", { href: `${API_BASE}${exported.downloadUrl}`, target: "_blank", rel: "noreferrer", children: exported.format }, exported.fileId))) })] })] }, item.id))) }))] }) }))] }));
};
export default App;
