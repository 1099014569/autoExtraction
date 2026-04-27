import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/index";
import type { ProviderConfig, RewriteMode } from "@autoextraction/shared";

export interface RewriteResult {
  rewrittenText: string;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
}

export interface Rewriter {
  rewrite: (params: {
    sourceTitle: string;
    sourceText: string;
    mode: RewriteMode;
    promptExtra?: string;
    provider?: ProviderConfig;
  }) => Promise<RewriteResult>;
}

export const getModeTemperature = (mode: RewriteMode): number => {
  return mode === "conservative" ? 0.35 : 0.95;
};

export const buildRewriteMessages = (params: {
  sourceTitle: string;
  sourceText: string;
  mode: RewriteMode;
  promptExtra?: string;
}): ChatCompletionMessageParam[] => {
  const systemPrompt =
    params.mode === "conservative"
      ? "你是中文内容编辑。请在保留原意、事实与结构主线的前提下改写文本，语言更流畅，避免逐句照搬。"
      : "你是中文创作编辑。请在不改变核心事实的前提下允许重组结构、重写表达和节奏，输出更具新鲜感的内容。";

  const userPrompt = [
    `原标题：${params.sourceTitle}`,
    "原文正文：",
    params.sourceText,
    params.promptExtra ? `附加要求：${params.promptExtra}` : undefined
  ]
    .filter(Boolean)
    .join("\n\n");

  return [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt }
  ];
};

export class OpenAIRewriter implements Rewriter {
  constructor(
    private readonly defaults: {
      baseUrl: string;
      apiKey: string;
      model: string;
    }
  ) {}

  async rewrite(params: {
    sourceTitle: string;
    sourceText: string;
    mode: RewriteMode;
    promptExtra?: string;
    provider?: ProviderConfig;
  }): Promise<RewriteResult> {
    const provider = params.provider ?? {
      baseUrl: this.defaults.baseUrl,
      apiKey: this.defaults.apiKey,
      model: this.defaults.model
    };

    if (!provider.apiKey) {
      throw new Error("缺少 AI API Key，请在页面填写或通过环境变量配置 OPENAI_API_KEY");
    }

    const client = new OpenAI({
      apiKey: provider.apiKey,
      baseURL: provider.baseUrl
    });

    const completion = await client.chat.completions.create({
      model: provider.model,
      temperature: getModeTemperature(params.mode),
      messages: buildRewriteMessages(params),
      max_tokens: 4000
    });

    const rewrittenText = completion.choices[0]?.message?.content?.trim();
    if (!rewrittenText) {
      throw new Error("AI 未返回可用文本");
    }

    const usage = completion.usage
      ? {
          ...(completion.usage.prompt_tokens !== undefined
            ? { promptTokens: completion.usage.prompt_tokens }
            : {}),
          ...(completion.usage.completion_tokens !== undefined
            ? { completionTokens: completion.usage.completion_tokens }
            : {}),
          ...(completion.usage.total_tokens !== undefined
            ? { totalTokens: completion.usage.total_tokens }
            : {})
        }
      : null;

    return {
      rewrittenText,
      ...(usage ? { usage } : {})
    };
  }
}
