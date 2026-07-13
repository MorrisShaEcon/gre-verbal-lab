import { describe, expect, it } from "vitest";
import { greMatchLocationLabel } from "./gre-question-display";

describe("GRE question match labels", () => {
  it("renders compact locations through option I", () => {
    expect(greMatchLocationLabel("stem")).toBe("题干");
    expect(greMatchLocationLabel("passage")).toBe("文章");
    expect(greMatchLocationLabel("option:A")).toBe("选项 A");
    expect(greMatchLocationLabel("option:I")).toBe("选项 I");
  });

  it("renders character-level option spans", () => {
    expect(greMatchLocationLabel({ field: "option", optionLabel: "I", start: 2, end: 8 })).toBe("选项 I");
  });
});
