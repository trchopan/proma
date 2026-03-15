import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { DigestItem, TopicRoutingTarget } from "$/domain/digest/types";
import {
  allocateNextIndex,
  chooseConsolidatedTarget,
  collectCategoryTagPool,
  listPendingDigestItems,
  listTopicCandidates,
  loadReportContext,
  markDigestItemMerged,
  prepareTopicMerge,
  rankTopicCandidates,
  resolveBaseReportFiles,
  resolveReportInputFiles,
  slugifyTopic,
  writeDigestItems,
  writePreparedTopicMerge,
  writeReportFile,
} from "$/files";

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

test("writeDigestItems writes to notes directory", async () => {
  await withTempDir(async (dir) => {
    const items: DigestItem[] = [
      {
        category: "research",
        source: "slack",
        summary: "Gather customer interview notes.",
        keyPoints: ["Track themes"],
        timeline: ["2026-03-10 - Interview synthesis starts"],
        references: [{ source: "slack", link: "https://example.com/notes" }],
      },
      {
        category: "research",
        source: "wiki",
        summary: "Analyze churn reasons.",
        keyPoints: [],
        timeline: [],
        references: [],
      },
    ];

    const written = await writeDigestItems({
      projectRoot: dir,
      items,
      inputRaw: path.join("raw", "input-1.md"),
      now: new Date("2026-03-09T10:00:00Z"),
    });

    expect(written.map((entry) => entry.absolutePath)).toEqual([
      path.join(dir, "notes", "research_2026-03-09_1.md"),
      path.join(dir, "notes", "research_2026-03-09_2.md"),
    ]);

    const content = await Bun.file(written[0]?.absolutePath ?? "").text();
    expect(content).toContain("---");
    expect(content).toContain("category: research");
    expect(content).toContain("source: slack");
    expect(content).toContain("merged: false");
    expect(content).toContain(`input_raw: '${path.join("raw", "input-1.md")}'`);
    expect(content).toContain("merged_topic_paths:");
  });
});

test("listPendingDigestItems returns only unmerged digest notes", async () => {
  await withTempDir(async (dir) => {
    const items: DigestItem[] = [
      {
        category: "planning",
        source: "wiki",
        summary: "Plan sprint goals.",
        keyPoints: ["Align scope"],
        timeline: ["2026-03-11 - Finalize sprint scope"],
        references: [],
      },
      {
        category: "decision",
        source: "slack",
        summary: "Discuss rollout risks.",
        keyPoints: ["Track mitigation"],
        timeline: ["2026-03-12 - Risk review in standup"],
        references: [],
      },
    ];

    const written = await writeDigestItems({
      projectRoot: dir,
      items,
      inputRaw: path.join("raw", "input-2.md"),
      now: new Date("2026-03-09T10:00:00Z"),
    });

    await markDigestItemMerged(written[0]?.absolutePath ?? "", [
      "topics/planning/sprint-goals.md",
    ]);

    const mergedContent = await Bun.file(written[0]?.absolutePath ?? "").text();
    expect(mergedContent).toContain("merged_topic_paths:");
    expect(mergedContent).toContain("topics/planning/sprint-goals.md");
    expect(mergedContent).toContain(
      `input_raw: '${path.join("raw", "input-2.md")}'`,
    );

    const pending = await listPendingDigestItems(dir);

    expect(pending.map((entry) => entry.relativePath)).toEqual([
      "notes/decision_2026-03-09_1.md",
    ]);
  });
});

test("listPendingDigestItems supports legacy digest notes without input_raw", async () => {
  await withTempDir(async (dir) => {
    const notesDir = path.join(dir, "notes");
    await mkdir(notesDir, { recursive: true });

    await Bun.write(
      path.join(notesDir, "planning_2026-03-09_1.md"),
      [
        "---",
        "category: planning",
        "source: wiki",
        "merged: false",
        "merged_topic_paths:",
        "---",
        "",
        "## Summary",
        "Legacy digest note without input_raw.",
        "",
        "## Key Points",
        "- Preserve backward compatibility",
        "",
        "## Timeline",
        "- 2026-03-09 - Digest created",
        "",
        "## References",
      ].join("\n"),
    );

    const pending = await listPendingDigestItems(dir);

    expect(pending).toHaveLength(1);
    expect(pending[0]?.relativePath).toBe("notes/planning_2026-03-09_1.md");
    expect(pending[0]?.item.summary).toBe(
      "Legacy digest note without input_raw.",
    );
  });
});

test("listTopicCandidates reads topic front matter", async () => {
  await withTempDir(async (dir) => {
    const topicDir = path.join(dir, "topics", "planning");
    await mkdir(topicDir, { recursive: true });
    await Bun.write(
      path.join(topicDir, "release-readiness.md"),
      [
        "---",
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
        "# Release Readiness",
        "",
        "## Summary",
        "Release readiness baseline.",
      ].join("\n"),
    );

    const candidates = await listTopicCandidates(dir, "planning");

    expect(candidates).toEqual([
      {
        slug: "release-readiness",
        topic: "Release Readiness",
        tags: ["qa", "release"],
        summary: "Release readiness baseline.",
        keyPoints: [],
        timeline: [],
        references: [],
        digestedCount: 0,
        updatedAt: "2026-03-09T00:00:00.000Z",
        timeboxes: [],
        anchors: [],
      },
    ]);
  });
});

test("rankTopicCandidates prioritizes overlapping references and tokens", () => {
  const ranked = rankTopicCandidates(
    {
      category: "planning",
      source: "slack",
      summary: "Release cadence policy with hotfix rules",
      keyPoints: ["Skip monthly release without agenda"],
      timeline: ["2026-03-13 - Publish decision"],
      references: [{ source: "slack", link: "https://example.com/thread" }],
    },
    [
      {
        slug: "release-plan",
        topic: "Release Plan",
        tags: ["release-plan"],
        summary: "Task schedule for v1.13",
        keyPoints: ["Assign PIC"],
        timeline: ["2026-03-10 - Start execution"],
        references: [],
        digestedCount: 1,
        updatedAt: "2026-03-10T00:00:00.000Z",
        timeboxes: [],
        anchors: [],
      },
      {
        slug: "release-cadence-policy",
        topic: "Release cadence policy",
        tags: ["release-cadence", "hotfix-process"],
        summary: "Policy for skipping releases and using hotfixes",
        keyPoints: ["Skip when no agenda"],
        timeline: ["2026-03-13 - Publish decision"],
        references: [{ source: "slack", link: "https://example.com/thread" }],
        digestedCount: 2,
        updatedAt: "2026-03-13T00:00:00.000Z",
        timeboxes: [],
        anchors: [],
      },
    ],
    8,
  );

  expect(ranked[0]?.slug).toBe("release-cadence-policy");
});

test("rankTopicCandidates enforces hard timebox preference when present", () => {
  const ranked = rankTopicCandidates(
    {
      category: "planning",
      source: "git",
      summary: "Update XLT for release/1.12.0",
      keyPoints: ["Merged PR for release/1.12.0"],
      timeline: ["2026-03-12 - PR merged"],
      references: [],
    },
    [
      {
        slug: "xlt-release-1-13-0",
        topic: "XLT updates release/1.13.0",
        tags: ["xlt", "release-1-13-0"],
        summary: "Track XLT updates for 1.13.0",
        keyPoints: ["Release 1.13 stream"],
        timeline: ["2026-03-10 - PR merged"],
        references: [],
        digestedCount: 4,
        updatedAt: "2026-03-10T00:00:00.000Z",
        timeboxes: ["release-1-13-0"],
        anchors: ["project-orion-web"],
      },
      {
        slug: "xlt-release-1-12-0",
        topic: "XLT updates release/1.12.0",
        tags: ["xlt", "release-1-12-0"],
        summary: "Track XLT updates for 1.12.0",
        keyPoints: ["Release 1.12 stream"],
        timeline: ["2026-03-12 - PR merged"],
        references: [],
        digestedCount: 2,
        updatedAt: "2026-03-12T00:00:00.000Z",
        timeboxes: ["release-1-12-0"],
        anchors: ["project-orion-web"],
      },
    ],
    8,
  );

  expect(ranked[0]?.slug).toBe("xlt-release-1-12-0");
});

test("chooseConsolidatedTarget keeps create_new when project anchors conflict", () => {
  const target = chooseConsolidatedTarget({
    item: {
      category: "planning",
      source: "slack",
      summary: "Project Atlas API deployment readiness for beta",
      keyPoints: ["Validate Project Atlas rollout"],
      timeline: ["2026-03-12 - Rollout decision"],
      references: [],
    },
    rankedCandidates: [
      {
        slug: "project-orion-web-release-1-12-0",
        topic: "Project Orion Web release/1.12.0 updates",
        tags: ["project-orion-web", "release-1-12-0"],
        summary: "Track Project Orion Web updates",
        keyPoints: ["Release readiness"],
        timeline: ["2026-03-12 - Update merged"],
        references: [],
        digestedCount: 5,
        updatedAt: "2026-03-12T00:00:00.000Z",
        timeboxes: ["release-1-12-0"],
        anchors: ["project-orion-web"],
      },
    ],
    aiTarget: {
      action: "create_new",
      shortDescription: "project-atlas-deployment",
      topic: "Project Atlas deployment",
      tags: ["project-atlas-api"],
    },
  });

  expect(target.action).toBe("create_new");
});

test("chooseConsolidatedTarget keeps create_new when candidate misses required timebox", () => {
  const target = chooseConsolidatedTarget({
    item: {
      category: "planning",
      source: "git",
      summary: "Update XLT for release/1.12.0",
      keyPoints: ["Release readiness"],
      timeline: ["2026-03-12 - PR merged"],
      references: [],
    },
    rankedCandidates: [
      {
        slug: "xlt-updates-general",
        topic: "XLT updates",
        tags: ["xlt"],
        summary: "General XLT workstream",
        keyPoints: ["Track XLT updates"],
        timeline: [],
        references: [],
        digestedCount: 7,
        updatedAt: "2026-03-12T00:00:00.000Z",
        timeboxes: [],
        anchors: ["project-orion-web"],
      },
    ],
    aiTarget: {
      action: "create_new",
      shortDescription: "xlt-release-1-12-0",
      topic: "XLT release/1.12.0",
      tags: ["xlt", "release-1-12-0"],
    },
  });

  expect(target.action).toBe("create_new");
});

test("chooseConsolidatedTarget downgrades unsafe update_existing to create_new", () => {
  const target = chooseConsolidatedTarget({
    item: {
      category: "planning",
      source: "git",
      summary: "Dependency update for project-orion-web release/1.12.0",
      keyPoints: ["Merged PR for release/1.12.0"],
      timeline: ["2026-03-12 - PR merged"],
      references: [
        {
          source: "git",
          link: "https://git.example.com/org/project-orion-web/pull/2601",
        },
      ],
    },
    rankedCandidates: [
      {
        slug: "project-atlas-mixed-topic",
        topic: "Project Atlas deployment coordination",
        tags: ["project-atlas-api", "project-orion-web"],
        summary: "Mixed topic should not be reused",
        keyPoints: ["Cross-project content"],
        timeline: ["2026-03-12 - Status update"],
        references: [],
        digestedCount: 9,
        updatedAt: "2026-03-14T00:00:00.000Z",
        timeboxes: ["release-1-12-0"],
        anchors: ["project-atlas-api", "project-orion-web"],
      },
    ],
    aiTarget: {
      action: "update_existing",
      slug: "project-atlas-mixed-topic",
      topic: "Project Atlas deployment coordination",
      tags: ["project-atlas-api"],
    },
  });

  expect(target.action).toBe("create_new");
});

test("collectCategoryTagPool normalizes and deduplicates tags", () => {
  const tags = collectCategoryTagPool([
    {
      slug: "a",
      topic: "A",
      tags: ["Release Cadence", "release-cadence"],
      summary: "A",
      keyPoints: [],
      timeline: [],
      references: [],
      digestedCount: 0,
      updatedAt: "",
      timeboxes: [],
      anchors: [],
    },
    {
      slug: "b",
      topic: "B",
      tags: ["Hotfix Process"],
      summary: "B",
      keyPoints: [],
      timeline: [],
      references: [],
      digestedCount: 0,
      updatedAt: "",
      timeboxes: [],
      anchors: [],
    },
  ]);

  expect(tags).toEqual(["hotfix-process", "release-cadence"]);
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
      category: "decision",
      item: {
        category: "decision",
        source: "slack",
        summary: "Discussed incident fixes",
        keyPoints: ["Backfill alerts"],
        timeline: ["2026-03-09 - Incident fixes approved"],
        references: [],
      },
      target,
      mergedDigestId: "notes/decision_2026-03-09_1.md",
      now: new Date("2026-03-09T10:00:00Z"),
    });

    expect(plan.relativeTargetPath).toBe(
      "topics/decision/incident-response.md",
    );
    expect(plan.proposedContent).toContain("# Incident Response");
    expect(plan.proposedContent).toContain(
      "updated_at: '2026-03-09T10:00:00.000Z'",
    );
    expect(plan.proposedContent).toContain("  - 'incident-response'");
    expect(plan.proposedContent).toContain("  - 'post-mortem'");
    expect(plan.proposedContent).toContain("## Summary");
    expect(plan.proposedContent).toContain("## Decision");
    expect(plan.proposedContent).toContain("## Context");
    expect(plan.proposedContent).toContain("## Options Considered");
    expect(plan.proposedContent).toContain("## Rationale / Tradeoffs");
    expect(plan.proposedContent).toContain("## Stakeholders");
    expect(plan.proposedContent).toContain("## References");
    expect(plan.proposedContent).toContain("digested_note_paths:");
    expect(plan.proposedContent).toContain("notes/decision_2026-03-09_1.md");
    expect(plan.proposedContent).not.toContain("source_refs:");
    expect(plan.proposedContent).not.toContain("merged_ingest_ids:");
    expect(plan.hasChanges).toBe(true);

    await writePreparedTopicMerge(plan);
    const written = await Bun.file(
      path.join(dir, "topics", "decision", "incident-response.md"),
    ).text();
    expect(written).toContain("## Summary");
  });
});

test("prepareTopicMerge is idempotent for same reference", async () => {
  await withTempDir(async (dir) => {
    const topicDir = path.join(dir, "topics", "planning");
    await mkdir(topicDir, { recursive: true });
    const existingPath = path.join(topicDir, "release-policy.md");

    await Bun.write(
      existingPath,
      [
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
        timeline: ["2026-03-09 - Policy published"],
        references: [{ source: "slack", link: "https://example.com/thread" }],
      },
      target: {
        action: "update_existing",
        slug: "release-policy",
        topic: "Release Policy",
        tags: ["release"],
      },
      mergedDigestId: "notes/planning_2026-03-09_3.md",
      now: new Date("2026-03-09T10:05:00Z"),
    });

    expect(secondPlan.hasChanges).toBe(false);
  });
});

test("slugifyTopic normalizes to kebab-case", () => {
  expect(slugifyTopic("  Sprint Planning #2 ")).toBe("sprint-planning-2");
});

test("resolveReportInputFiles uses explicit --input values only", async () => {
  await withTempDir(async (dir) => {
    const planningFile = path.join(dir, "topics", "planning", "release.md");
    await mkdir(path.dirname(planningFile), { recursive: true });
    await Bun.write(planningFile, "# planning");

    const resolved = await resolveReportInputFiles(dir, [planningFile]);
    expect(resolved).toEqual([planningFile]);
  });
});

test("resolveReportInputFiles rejects explicit legacy non-topics path", async () => {
  await withTempDir(async (dir) => {
    const legacyFile = path.join(dir, "planning", "release.md");
    await mkdir(path.dirname(legacyFile), { recursive: true });
    await Bun.write(legacyFile, "# planning");

    await expect(resolveReportInputFiles(dir, [legacyFile])).rejects.toThrow(
      "Invalid --input file (must be under <project>/topics/<category>/)",
    );
  });
});

test("resolveReportInputFiles falls back to topics/planning|research|decision", async () => {
  await withTempDir(async (dir) => {
    const planningFile = path.join(dir, "topics", "planning", "a.md");
    const researchFile = path.join(dir, "topics", "research", "b.md");
    const decisionFile = path.join(dir, "topics", "decision", "c.md");

    await mkdir(path.dirname(planningFile), { recursive: true });
    await mkdir(path.dirname(researchFile), { recursive: true });
    await mkdir(path.dirname(decisionFile), { recursive: true });
    await Bun.write(planningFile, "# a");
    await Bun.write(researchFile, "# b");
    await Bun.write(decisionFile, "# c");

    const resolved = await resolveReportInputFiles(dir, []);
    expect(resolved).toEqual([planningFile, researchFile, decisionFile]);
  });
});

test("resolveBaseReportFiles falls back to reports directory", async () => {
  await withTempDir(async (dir) => {
    const reportsDir = path.join(dir, "reports");
    await mkdir(reportsDir, { recursive: true });
    const reportA = path.join(reportsDir, "2026-03-01_weekly.md");
    const reportB = path.join(reportsDir, "2026-03-08_weekly.md");
    await Bun.write(reportA, "# A");
    await Bun.write(reportB, "# B");

    const resolved = await resolveBaseReportFiles(dir, []);
    expect(resolved).toEqual([reportA, reportB]);
  });
});

test("loadReportContext parses input and base report context", async () => {
  await withTempDir(async (dir) => {
    const inputPath = path.join(dir, "topics", "planning", "release.md");
    const basePath = path.join(dir, "reports", "2026-03-08_weekly.md");
    await mkdir(path.dirname(inputPath), { recursive: true });
    await mkdir(path.dirname(basePath), { recursive: true });

    await Bun.write(
      inputPath,
      [
        "---",
        "category: planning",
        "---",
        "",
        "# Release Readiness",
        "",
        "## Summary",
        "Release status update",
        "",
        "## Key Points",
        "- QA signoff received",
        "",
        "## Timeline",
        "- 2026-03-09 - QA signoff",
        "",
        "## References",
        "- git: https://example.com/pr/1",
      ].join("\n"),
    );

    await Bun.write(
      basePath,
      [
        "---",
        "period: weekly",
        "generated_at: '2026-03-08T10:00:00.000Z'",
        "---",
        "",
        "# Weekly Project Report",
        "",
        "Previous context",
      ].join("\n"),
    );

    const context = await loadReportContext({
      projectRoot: dir,
      period: "weekly",
      inputFiles: [inputPath],
      baseFiles: [basePath],
    });

    expect(context.period).toBe("weekly");
    expect(context.inputs).toEqual([
      {
        path: "topics/planning/release.md",
        category: "planning",
        topic: "Release Readiness",
        summary: "Release status update",
        keyPoints: ["QA signoff received"],
        timeline: ["2026-03-09 - QA signoff"],
        references: ["git: https://example.com/pr/1"],
      },
    ]);
    expect(context.baseReports[0]?.path).toBe("reports/2026-03-08_weekly.md");
    expect(context.baseReports[0]?.period).toBe("weekly");
    expect(context.baseReports[0]?.title).toBe("Weekly Project Report");
  });
});

test("writeReportFile writes front matter and deterministic name", async () => {
  await withTempDir(async (dir) => {
    const first = await writeReportFile({
      projectRoot: dir,
      period: "weekly",
      model: "gpt-5.2",
      inputFiles: [path.join(dir, "topics", "planning", "release.md")],
      baseFiles: [path.join(dir, "reports", "2026-03-01_weekly.md")],
      markdown: "# Weekly Report\n",
      now: new Date("2026-03-09T10:00:00.000Z"),
    });

    expect(first.relativePath).toBe("reports/2026-03-09_weekly.md");
    const firstContent = await Bun.file(first.absolutePath).text();
    expect(firstContent).toContain("period: weekly");
    expect(firstContent).toContain("model: 'gpt-5.2'");
    expect(firstContent).toContain("input_files:");
    expect(firstContent).toContain("base_reports:");

    const second = await writeReportFile({
      projectRoot: dir,
      period: "weekly",
      model: "gpt-5.2",
      inputFiles: [],
      baseFiles: [],
      markdown: "# Weekly Report 2\n",
      now: new Date("2026-03-09T10:01:00.000Z"),
    });

    expect(second.relativePath).toBe("reports/2026-03-09_weekly_2.md");
  });
});
