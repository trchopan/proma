import { expect, test } from "bun:test";

import {
  type DigestItem,
  parseDigestItemsResponse,
  renderDigestMarkdown,
} from "../src/digest";

test("parseDigestItemsResponse accepts fenced JSON", () => {
  const response = [
    "```json",
    JSON.stringify([
      {
        category: "planning",
        source: "slack",
        summary: "Plan Q2 launch milestones.",
        keyPoints: ["Draft timeline", "Define dependencies"],
        references: [{ source: "slack", link: "https://example.com/plan" }],
      },
    ]),
    "```",
  ].join("\n");

  const items = parseDigestItemsResponse(response);

  expect(items).toHaveLength(1);
  expect(items[0]).toEqual({
    category: "planning",
    source: "slack",
    summary: "Plan Q2 launch milestones.",
    keyPoints: ["Draft timeline", "Define dependencies"],
    references: [{ source: "slack", link: "https://example.com/plan" }],
  });
});

test("parseDigestItemsResponse rejects invalid source", () => {
  const response = JSON.stringify([
    {
      category: "planning",
      source: "notion",
      summary: "Invalid source sample",
      keyPoints: [],
      references: [],
    },
  ]);

  expect(() => parseDigestItemsResponse(response)).toThrow(
    "Digest item contained invalid source",
  );
});

test("parseDigestItemsResponse rejects invalid category", () => {
  const response = JSON.stringify([
    {
      category: "ops",
      summary: "Invalid category sample",
      keyPoints: [],
      references: [],
    },
  ]);

  expect(() => parseDigestItemsResponse(response)).toThrow(
    "Digest item contained invalid category",
  );
});

test("renderDigestMarkdown always includes required sections", () => {
  const item: DigestItem = {
    category: "research",
    source: "wiki",
    summary: "Compare competitor onboarding patterns.",
    keyPoints: ["Analyze signup funnel", "Review activation metrics"],
    references: [{ source: "wiki", link: "https://example.com/onboarding" }],
  };

  const markdown = renderDigestMarkdown(item);

  expect(markdown).toContain("## Summary");
  expect(markdown).toContain("## Key Points");
  expect(markdown).toContain("## References");
  expect(markdown).toContain("- wiki: https://example.com/onboarding");
});

test("parseDigestItemsResponse rejects invalid reference source", () => {
  const response = JSON.stringify([
    {
      category: "planning",
      source: "slack",
      summary: "Reference source should fail",
      keyPoints: [],
      references: [{ source: "drive", link: "https://example.com/doc" }],
    },
  ]);

  expect(() => parseDigestItemsResponse(response)).toThrow(
    "Digest item contained invalid reference source",
  );
});
