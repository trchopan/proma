import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { DigestItem, TopicRoutingTarget } from "../src/digest";
import {
  allocateNextIndex,
  listTopicCandidates,
  prepareTopicMerge,
  slugifyTopic,
  writePreparedTopicMerge,
  writeStageOneDigestItems,
} from "../src/files";

async function withTempDir(run: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(path.join(tmpdir(), "proma-tests-"));

  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("allocateNextIndex increments from existing prefixed files", async () => {
  await withTempDir(async (dir) => {
    const notesDir = path.join(dir, "demo", "notes");
    await mkdir(notesDir, { recursive: true });

    await Bun.write(path.join(notesDir, "planning_2026-03-09_1.md"), "a");
    await Bun.write(path.join(notesDir, "planning_2026-03-09_4.md"), "b");
    await Bun.write(path.join(notesDir, "planning_2026-03-08_10.md"), "c");

    const next = await allocateNextIndex(notesDir, "planning_2026-03-09");

    expect(next).toBe(5);
  });
});

test("writeStageOneDigestItems writes to notes directory", async () => {
  await withTempDir(async (dir) => {
    const items: DigestItem[] = [
      {
        category: "research",
        source: "slack",
        summary: "Gather customer interview notes.",
        keyPoints: ["Track themes"],
        references: [{ source: "slack", link: "https://example.com/notes" }],
      },
      {
        category: "research",
        source: "wiki",
        summary: "Analyze churn reasons.",
        keyPoints: [],
        references: [],
      },
    ];

    const written = await writeStageOneDigestItems({
      projectRoot: dir,
      items,
      now: new Date("2026-03-09T10:00:00Z"),
    });

    expect(written.map((entry) => entry.absolutePath)).toEqual([
      path.join(dir, "notes", "research_2026-03-09_1.md"),
      path.join(dir, "notes", "research_2026-03-09_2.md"),
    ]);
  });
});

test("listTopicCandidates reads topic front matter", async () => {
  await withTempDir(async (dir) => {
    const topicDir = path.join(dir, "planning");
    await mkdir(topicDir, { recursive: true });
    await Bun.write(
      path.join(topicDir, "release-readiness.md"),
      [
        "---",
        "topic: 'Release Readiness'",
        "category: planning",
        "created_at: '2026-03-09T00:00:00.000Z'",
        "updated_at: '2026-03-09T00:00:00.000Z'",
        "tags:",
        "  - release",
        "  - qa",
        "sources:",
        "  - git",
        "---",
        "",
        "## Digest Entries",
      ].join("\n"),
    );

    const candidates = await listTopicCandidates(dir, "planning");

    expect(candidates).toEqual([
      {
        slug: "release-readiness",
        topic: "Release Readiness",
        tags: ["qa", "release"],
        summary: "Release Readiness",
      },
    ]);
  });
});

test("prepareTopicMerge creates normalized front matter and merged body", async () => {
  await withTempDir(async (dir) => {
    const target: TopicRoutingTarget = {
      action: "create_new",
      shortDescription: "Incident Response",
      topic: "Incident Response",
      tags: ["Post Mortem", "incident-response"],
    };

    const plan = await prepareTopicMerge({
      projectRoot: dir,
      category: "discussion",
      item: {
        category: "discussion",
        source: "slack",
        summary: "Discussed incident fixes",
        keyPoints: ["Backfill alerts"],
        references: [],
      },
      target,
      now: new Date("2026-03-09T10:00:00Z"),
    });

    expect(plan.relativeTargetPath).toBe("discussion/incident-response.md");
    expect(plan.proposedContent).toContain("topic: 'Incident Response'");
    expect(plan.proposedContent).toContain(
      "updated_at: '2026-03-09T10:00:00.000Z'",
    );
    expect(plan.proposedContent).toContain("  - 'incident-response'");
    expect(plan.proposedContent).toContain("  - 'post-mortem'");
    expect(plan.proposedContent).toContain("## Summary");
    expect(plan.proposedContent).toContain("## Key Points");
    expect(plan.proposedContent).toContain("## References");
    expect(plan.proposedContent).toContain("source_refs:");
    expect(plan.proposedContent).toContain("merged_digest_ids:");
    expect(plan.hasChanges).toBe(true);

    await writePreparedTopicMerge(plan);
    const written = await Bun.file(
      path.join(dir, "discussion", "incident-response.md"),
    ).text();
    expect(written).toContain("## Summary");
  });
});

test("prepareTopicMerge is idempotent for same reference", async () => {
  await withTempDir(async (dir) => {
    const topicDir = path.join(dir, "planning");
    await mkdir(topicDir, { recursive: true });
    const existingPath = path.join(topicDir, "release-policy.md");

    await Bun.write(
      existingPath,
      [
        "---",
        "topic: 'Release Policy'",
        "category: planning",
        "created_at: '2026-03-09T00:00:00.000Z'",
        "updated_at: '2026-03-09T00:00:00.000Z'",
        "tags:",
        "  - 'release'",
        "sources:",
        "  - slack",
        "source_refs:",
        "  - 'slack: https://example.com/thread'",
        "merged_digest_ids:",
        "  - 'refs:slack: https://example.com/thread'",
        "---",
        "",
        "## Summary",
        "Existing summary",
        "",
        "## Key Points",
        "- Existing point",
        "",
        "## References",
        "- slack: https://example.com/thread",
        "",
      ].join("\n"),
    );

    const firstPlan = await prepareTopicMerge({
      projectRoot: dir,
      category: "planning",
      item: {
        category: "planning",
        source: "slack",
        summary: "Another wording",
        keyPoints: ["Existing point"],
        references: [{ source: "slack", link: "https://example.com/thread" }],
      },
      target: {
        action: "update_existing",
        slug: "release-policy",
        topic: "Release Policy",
        tags: ["release"],
      },
      now: new Date("2026-03-09T10:00:00Z"),
    });

    if (firstPlan.hasChanges) {
      await writePreparedTopicMerge(firstPlan);
    }

    const secondPlan = await prepareTopicMerge({
      projectRoot: dir,
      category: "planning",
      item: {
        category: "planning",
        source: "slack",
        summary: "Another wording",
        keyPoints: ["Existing point"],
        references: [{ source: "slack", link: "https://example.com/thread" }],
      },
      target: {
        action: "update_existing",
        slug: "release-policy",
        topic: "Release Policy",
        tags: ["release"],
      },
      now: new Date("2026-03-09T10:05:00Z"),
    });

    expect(secondPlan.hasChanges).toBe(false);
  });
});

test("slugifyTopic normalizes to kebab-case", () => {
  expect(slugifyTopic("  Sprint Planning #2 ")).toBe("sprint-planning-2");
});
