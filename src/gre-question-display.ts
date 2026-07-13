import type { GreQuestionMatchLocation } from "./types";

export function greMatchLocationLabel(location: GreQuestionMatchLocation): string {
  if (typeof location === "string") {
    if (location === "stem") return "题干";
    if (location === "passage") return "文章";
    const option = location.match(/^option:([A-I])$/)?.[1];
    return option ? `选项 ${option}` : location;
  }
  if (location.field === "passageText") return "文章";
  if (location.field === "questionText") return "题干";
  return location.optionLabel ? `选项 ${location.optionLabel}` : "选项";
}
