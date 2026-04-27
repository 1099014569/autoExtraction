import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
import type { ProviderConfig, RewriteLocalState } from "@autoextraction/shared";

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

export interface RewriteLocalStateStore {
  getState: () => RewriteLocalState;
  saveState: (state: RewriteLocalState) => RewriteLocalState;
}

export const createDefaultRewriteLocalState = (provider: ProviderConfig): RewriteLocalState => ({
  provider: {
    baseUrl: provider.baseUrl,
    apiKey: provider.apiKey,
    model: provider.model
  },
  rewriteMode: "conservative",
  promptExtra: "",
  rewrittenText: ""
});

export class FileRewriteLocalStateStore implements RewriteLocalStateStore {
  constructor(
    private readonly filePath: string,
    private readonly defaultProvider: ProviderConfig
  ) {
    mkdirSync(dirname(this.filePath), { recursive: true });
  }

  getState(): RewriteLocalState {
    const fallback = createDefaultRewriteLocalState(this.defaultProvider);
    if (!existsSync(this.filePath)) {
      return fallback;
    }

    try {
      const raw = readFileSync(this.filePath, "utf8");
      if (!raw.trim()) {
        return fallback;
      }
      return rewriteLocalStateSchema.parse(JSON.parse(raw));
    } catch {
      return fallback;
    }
  }

  saveState(state: RewriteLocalState): RewriteLocalState {
    const normalized = rewriteLocalStateSchema.parse(state);
    writeFileSync(this.filePath, JSON.stringify(normalized, null, 2), "utf8");
    return normalized;
  }
}
