import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  listPendingStageOneDigestItems,
  prepareTopicMerge,
} from "../src/files";

async function withTempDir(run: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "proma-parity-"));
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("legacy staged note fixture is treated as pending", async () => {
  await withTempDir(async (projectRoot) => {
    const notesDir = path.join(projectRoot, "notes");
    await mkdir(notesDir, { recursive: true });

    const fixturePath = path.join(
      import.meta.dir,
      "fixtures",
      "legacy-stage-note.md",
    );
    const fixtureText = await Bun.file(fixturePath).text();
    await Bun.write(
      path.join(notesDir, "planning_2026-03-09_1.md"),
      fixtureText,
    );

    const pending = await listPendingStageOneDigestItems(projectRoot);
    expect(pending).toHaveLength(1);
    expect(pending[0]?.item.category).toBe("planning");
    expect(pending[0]?.item.source).toBe("wiki");
  });
});

test("legacy append topic fixture is migrated into canonical sections", async () => {
  await withTempDir(async (projectRoot) => {
    const planningDir = path.join(projectRoot, "planning");
    await mkdir(planningDir, { recursive: true });

    const fixturePath = path.join(
      import.meta.dir,
      "fixtures",
      "legacy-topic-append.md",
    );
    const fixtureText = await Bun.file(fixturePath).text();
    await Bun.write(
      path.join(planningDir, "release-readiness.md"),
      fixtureText,
    );

    const plan = await prepareTopicMerge({
      projectRoot,
      category: "planning",
      item: {
        category: "planning",
        source: "slack",
        summary: "Release readiness summary",
        keyPoints: ["Align release checklist"],
        timeline: ["2026-03-10 - Checklist reviewed"],
        references: [{ source: "slack", link: "https://example.com/thread" }],
      },
      target: {
        action: "update_existing",
        slug: "release-readiness",
        topic: "Release Readiness",
        tags: ["release"],
      },
      now: new Date("2026-03-09T10:00:00Z"),
    });

    expect(plan.hasChanges).toBe(true);
    expect(plan.proposedContent).toContain("## Summary");
    expect(plan.proposedContent).toContain("## Key Points");
    expect(plan.proposedContent).toContain("## Timeline");
    expect(plan.proposedContent).toContain("## References");
    expect(plan.proposedContent).not.toContain("## Digest Entries");
  });
});
