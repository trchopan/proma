import { expect, test } from "bun:test";

import {
  buildTopicMergeContent,
  slugifyTopic,
} from "../src/services/topic-merge";

test("slugifyTopic normalizes user text", () => {
  expect(slugifyTopic(" Incident Response #2 ")).toBe("incident-response-2");
});

test("buildTopicMergeContent is no-op when digest id already merged", () => {
  const currentContent = [
    "---",
    "category: planning",
    "created_at: '2026-03-09T00:00:00.000Z'",
    "updated_at: '2026-03-09T00:00:00.000Z'",
    "tags:",
    "  - 'release'",
    "sources:",
    "  - slack",
    "merged_digest_ids:",
    "  - 'refs:slack: https://example.com/thread'",
    "---",
    "",
    "# Release Policy",
    "",
    "## Summary",
    "Existing summary",
    "",
    "## Key Points",
    "- Existing point",
    "",
    "## Timeline",
    "- 2026-03-09 - Policy published",
    "",
    "## References",
    "- None",
    "",
  ].join("\n");

  const result = buildTopicMergeContent({
    currentContent,
    category: "planning",
    item: {
      category: "planning",
      source: "slack",
      summary: "New wording",
      keyPoints: ["Existing point"],
      timeline: ["2026-03-09 - Policy published"],
      references: [{ source: "slack", link: "https://example.com/thread" }],
    },
    target: {
      action: "update_existing",
      slug: "release-policy",
      topic: "Release Policy",
      tags: ["release"],
    },
  });

  expect(result.hasChanges).toBe(false);
  expect(result.proposedContent).toBe(currentContent);
});

test("buildTopicMergeContent ignores legacy source_refs when merging", () => {
  const currentContent = [
    "---",
    "category: planning",
    "created_at: '2026-03-09T00:00:00.000Z'",
    "updated_at: '2026-03-09T00:00:00.000Z'",
    "tags:",
    "  - 'release'",
    "sources:",
    "  - slack",
    "source_refs:",
    "  - 'slack: https://example.com/thread'",
    "---",
    "",
    "# Release Policy",
    "",
    "## Summary",
    "Existing summary",
    "",
    "## Key Points",
    "- Existing point",
    "",
    "## Timeline",
    "- 2026-03-09 - Policy published",
    "",
    "## References",
    "- None",
    "",
  ].join("\n");

  const result = buildTopicMergeContent({
    currentContent,
    category: "planning",
    item: {
      category: "planning",
      source: "slack",
      summary: "New wording",
      keyPoints: ["Existing point"],
      timeline: ["2026-03-09 - Policy published"],
      references: [{ source: "slack", link: "https://example.com/thread" }],
    },
    target: {
      action: "update_existing",
      slug: "release-policy",
      topic: "Release Policy",
      tags: ["release"],
    },
  });

  expect(result.hasChanges).toBe(true);
  expect(result.proposedContent).toContain("merged_digest_ids:");
  expect(result.proposedContent).not.toContain("source_refs:");
});

test("buildTopicMergeContent emits references in deterministic order", () => {
  const currentContent = [
    "---",
    "category: planning",
    "created_at: '2026-03-09T00:00:00.000Z'",
    "updated_at: '2026-03-09T00:00:00.000Z'",
    "tags:",
    "  - 'release'",
    "sources:",
    "  - slack",
    "merged_digest_ids:",
    "---",
    "",
    "# Release Policy",
    "",
    "## Summary",
    "Existing summary",
    "",
    "## Key Points",
    "- Existing point",
    "",
    "## Timeline",
    "- 2026-03-09 - Policy published",
    "",
    "## References",
    "- slack: https://example.com/thread",
    "",
  ].join("\n");

  const result = buildTopicMergeContent({
    currentContent,
    category: "planning",
    item: {
      category: "planning",
      source: "slack",
      summary: "New wording",
      keyPoints: ["Existing point"],
      timeline: ["2026-03-09 - Policy published"],
      references: [
        { source: "git", link: "https://example.com/pr/1" },
        { source: "slack", link: "https://example.com/thread" },
      ],
    },
    target: {
      action: "update_existing",
      slug: "release-policy",
      topic: "Release Policy",
      tags: ["release"],
    },
  });

  const githubRefIndex = result.proposedContent.indexOf(
    "- git: https://example.com/pr/1",
  );
  const slackRefIndex = result.proposedContent.indexOf(
    "- slack: https://example.com/thread",
  );

  expect(result.hasChanges).toBe(true);
  expect(githubRefIndex).toBeGreaterThan(-1);
  expect(slackRefIndex).toBeGreaterThan(-1);
  expect(githubRefIndex).toBeLessThan(slackRefIndex);
});
