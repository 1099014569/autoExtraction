import { describe, expect, it } from "vitest";
import { buildRewriteMessages, getModeTemperature } from "../../src/services/rewriteService.js";

describe("rewriteService", () => {
  it("保守模式应生成偏稳健的系统提示词", () => {
    const messages = buildRewriteMessages({
      mode: "conservative",
      sourceTitle: "原标题",
      sourceText: "原始正文内容"
    });
    expect(messages[0]?.content).toContain("保留原意");
    expect(messages[1]?.content).toContain("原标题");
  });

  it("深度模式应生成更高创造性的提示词", () => {
    const messages = buildRewriteMessages({
      mode: "aggressive",
      sourceTitle: "原标题",
      sourceText: "原始正文内容",
      promptExtra: "语气更口语化"
    });
    expect(messages[0]?.content).toContain("允许重组结构");
    expect(messages[1]?.content).toContain("语气更口语化");
  });

  it("不同模式温度应不同", () => {
    expect(getModeTemperature("conservative")).toBeLessThan(getModeTemperature("aggressive"));
  });
});
