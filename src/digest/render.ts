import type { DigestItem } from "./types";

export function renderDigestMarkdown(item: DigestItem): string {
  const keyPoints =
    item.keyPoints.length > 0
      ? item.keyPoints.map((value) => `- ${value}`).join("\n")
      : "- None";
  const timeline =
    item.timeline.length > 0
      ? item.timeline.map((value) => `- ${value}`).join("\n")
      : "- None";
  const references =
    item.references.length > 0
      ? item.references
          .map((value) => `- ${value.source}: ${value.link}`)
          .join("\n")
      : "- None";

  return [
    "## Summary",
    item.summary,
    "",
    "## Key Points",
    keyPoints,
    "",
    "## Timeline",
    timeline,
    "",
    "## References",
    references,
    "",
  ].join("\n");
}
