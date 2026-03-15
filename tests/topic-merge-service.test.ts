import { expect, test } from "bun:test";

import {
  buildTopicMergeContent,
  governTags,
  slugifyTopic,
} from "$/domain/merge/topic-merge";

test("slugifyTopic normalizes user text", () => {
  expect(slugifyTopic(" Incident Response #2 ")).toBe("incident-response-2");
});

test("slugifyTopic truncates long slugs to 100 chars", () => {
  const slug = slugifyTopic("a ".repeat(120));
  expect(slug.length).toBeLessThanOrEqual(100);
  expect(slug).not.toEndWith("-");
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
    "digested_note_paths:",
    "  - 'notes/planning_2026-03-09_1.md'",
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
    mergedDigestId: "notes/planning_2026-03-09_1.md",
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
    mergedDigestId: "notes/planning_2026-03-09_2.md",
  });

  expect(result.hasChanges).toBe(true);
  expect(result.proposedContent).toContain("digested_note_paths:");
  expect(result.proposedContent).toContain("notes/planning_2026-03-09_2.md");
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
    "digested_note_paths:",
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
    mergedDigestId: "notes/planning_2026-03-09_3.md",
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

test("governTags reuses pool tags and limits additions", () => {
  const tags = governTags({
    existingTags: ["release-cadence"],
    incomingTags: ["Release Planning"],
    aiTags: ["release-cadence", "release-planning", "new-shiny-tag"],
    tagPool: ["release-cadence", "release-planning"],
    maxTags: 3,
  });

  expect(tags).toEqual([
    "release-cadence",
    "release-planning",
    "new-shiny-tag",
  ]);
});

test("buildTopicMergeContent extracts git handle into canonical participant format", () => {
  const currentContent = [
    "---",
    "category: planning",
    "created_at: '2026-03-09T00:00:00.000Z'",
    "updated_at: '2026-03-09T00:00:00.000Z'",
    "tags:",
    "  - 'release'",
    "sources:",
    "  - git",
    "digested_note_paths:",
    "---",
    "",
    "# Release Update",
    "",
    "## Summary",
    "Existing summary",
    "",
    "## Objectives / Success Criteria",
    "- Existing point",
    "",
    "## Scope",
    "- None",
    "",
    "## Deliverables",
    "- None",
    "",
    "## Plan",
    "- None",
    "",
    "## Timeline",
    "- 2026-03-09 - Policy published",
    "",
    "## Teams/Individuals Involved",
    "- None",
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
      source: "git",
      summary: "PR merged for release branch",
      keyPoints: ["Status: closed and merged by alex-dev."],
      timeline: ["2026-03-10 - PR merged"],
      references: [{ source: "git", link: "https://example.com/pr/2590" }],
    },
    target: {
      action: "update_existing",
      slug: "release-update",
      topic: "Release Update",
      tags: ["release"],
    },
    mergedDigestId: "notes/planning_2026-03-10_1.md",
  });

  expect(result.proposedContent).toContain("## Teams/Individuals Involved");
  expect(result.proposedContent).toContain("- (git:alex-dev)");
});

test("buildTopicMergeContent normalizes slack identities with and without display name", () => {
  const currentContent = [
    "---",
    "category: planning",
    "created_at: '2026-03-09T00:00:00.000Z'",
    "updated_at: '2026-03-09T00:00:00.000Z'",
    "tags:",
    "  - 'coordination'",
    "sources:",
    "  - slack",
    "digested_note_paths:",
    "---",
    "",
    "# Team Coordination",
    "",
    "## Summary",
    "Existing summary",
    "",
    "## Objectives / Success Criteria",
    "- Existing point",
    "",
    "## Scope",
    "- None",
    "",
    "## Deliverables",
    "- None",
    "",
    "## Plan",
    "- None",
    "",
    "## Timeline",
    "- None",
    "",
    "## Teams/Individuals Involved",
    "- None",
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
      summary: "Coordination updates with @g-mp-fe",
      keyPoints: ["Owner: Jordan Vale (@TranQuang)"],
      timeline: ["2026-03-11 - Ownership clarified"],
      references: [{ source: "slack", link: "https://example.com/thread" }],
    },
    target: {
      action: "update_existing",
      slug: "team-coordination",
      topic: "Team Coordination",
      tags: ["coordination"],
    },
    mergedDigestId: "notes/planning_2026-03-11_1.md",
  });

  expect(result.proposedContent).toContain("- Jordan Vale (slack:TranQuang)");
  expect(result.proposedContent).toContain("- (slack:g-mp-fe)");
});

test("buildTopicMergeContent prefers display-name identity over handle-only duplicate", () => {
  const currentContent = [
    "---",
    "category: planning",
    "created_at: '2026-03-09T00:00:00.000Z'",
    "updated_at: '2026-03-09T00:00:00.000Z'",
    "tags:",
    "  - 'release'",
    "sources:",
    "  - git",
    "digested_note_paths:",
    "---",
    "",
    "# Release Update",
    "",
    "## Summary",
    "Existing summary",
    "",
    "## Objectives / Success Criteria",
    "- Existing point",
    "",
    "## Scope",
    "- None",
    "",
    "## Deliverables",
    "- None",
    "",
    "## Plan",
    "- None",
    "",
    "## Timeline",
    "- None",
    "",
    "## Teams/Individuals Involved",
    "- (git:alex-dev)",
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
      source: "git",
      summary: "PR merged",
      keyPoints: ["PR merged into release branch."],
      timeline: ["2026-03-10 - PR merged"],
      references: [{ source: "git", link: "https://example.com/pr/2600" }],
    },
    mergeContent: {
      category: "planning",
      summary: "PR merged",
      objectivesSuccessCriteria: ["Existing point"],
      scope: [],
      deliverables: [],
      plan: [],
      timeline: ["2026-03-10 - PR merged"],
      teamsIndividualsInvolved: ["Alex Dev (git:alex-dev)"],
      references: [{ source: "git", link: "https://example.com/pr/2600" }],
      tags: ["release"],
    },
    target: {
      action: "update_existing",
      slug: "release-update",
      topic: "Release Update",
      tags: ["release"],
    },
    mergedDigestId: "notes/planning_2026-03-10_2.md",
  });

  expect(result.proposedContent).toContain("- Alex Dev (git:alex-dev)");
  expect(result.proposedContent).not.toContain(
    "## Teams/Individuals Involved\n- (git:alex-dev)",
  );
});

test("buildTopicMergeContent does not coerce nickname parentheses into handle identities", () => {
  const currentContent = [
    "---",
    "category: planning",
    "created_at: '2026-03-09T00:00:00.000Z'",
    "updated_at: '2026-03-09T00:00:00.000Z'",
    "tags:",
    "  - 'coordination'",
    "sources:",
    "  - slack",
    "digested_note_paths:",
    "---",
    "",
    "# Team Coordination",
    "",
    "## Summary",
    "Existing summary",
    "",
    "## Objectives / Success Criteria",
    "- Existing point",
    "",
    "## Scope",
    "- None",
    "",
    "## Deliverables",
    "- None",
    "",
    "## Plan",
    "- None",
    "",
    "## Timeline",
    "- None",
    "",
    "## Teams/Individuals Involved",
    "- Tran Ba Quan (Cyan)",
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
      summary: "Coordination update",
      keyPoints: ["Need FE deployment update."],
      timeline: ["2026-03-11 - Follow-up"],
      references: [{ source: "slack", link: "https://example.com/thread" }],
    },
    target: {
      action: "update_existing",
      slug: "team-coordination",
      topic: "Team Coordination",
      tags: ["coordination"],
    },
    mergedDigestId: "notes/planning_2026-03-11_2.md",
  });

  expect(result.proposedContent).toContain("- Tran Ba Quan (Cyan)");
  expect(result.proposedContent).not.toContain("(slack:Cyan)");
});

test("buildTopicMergeContent skips partial-name mentions but parses slack user mentions", () => {
  const currentContent = [
    "---",
    "category: planning",
    "created_at: '2026-03-09T00:00:00.000Z'",
    "updated_at: '2026-03-09T00:00:00.000Z'",
    "tags:",
    "  - 'coordination'",
    "sources:",
    "  - slack",
    "digested_note_paths:",
    "---",
    "",
    "# Team Coordination",
    "",
    "## Summary",
    "Existing summary",
    "",
    "## Objectives / Success Criteria",
    "- Existing point",
    "",
    "## Scope",
    "- None",
    "",
    "## Deliverables",
    "- None",
    "",
    "## Plan",
    "- None",
    "",
    "## Timeline",
    "- None",
    "",
    "## Teams/Individuals Involved",
    "- None",
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
      summary:
        "@Phuoc Vo asked <@U05SKA6JQBZ|Tran Ba Quan (Cyan)> to review with @g-mp-fe.",
      keyPoints: ["@James to coordinate next steps."],
      timeline: ["2026-03-11 - Ownership clarified"],
      references: [{ source: "slack", link: "https://example.com/thread" }],
    },
    target: {
      action: "update_existing",
      slug: "team-coordination",
      topic: "Team Coordination",
      tags: ["coordination"],
    },
    mergedDigestId: "notes/planning_2026-03-11_3.md",
  });

  expect(result.proposedContent).toContain(
    "- Tran Ba Quan (Cyan) (slack:U05SKA6JQBZ)",
  );
  expect(result.proposedContent).toContain("- (slack:g-mp-fe)");
  expect(result.proposedContent).toContain("- (slack:James)");
  expect(result.proposedContent).not.toContain("(slack:Phuoc)");
});
