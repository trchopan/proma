import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { DigestItem } from "../src/digest";
import { allocateNextIndex, writeDigestItems } from "../src/files";

async function withTempDir(run: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(path.join(tmpdir(), "proma-tests-"));

  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("allocateNextIndex increments from existing same-day files", async () => {
  await withTempDir(async (dir) => {
    const categoryDir = path.join(dir, "demo", "planning");
    await mkdir(categoryDir, { recursive: true });

    await Bun.write(path.join(categoryDir, "2026-03-09_1.md"), "a");
    await Bun.write(path.join(categoryDir, "2026-03-09_4.md"), "b");
    await Bun.write(path.join(categoryDir, "2026-03-08_10.md"), "c");

    const next = await allocateNextIndex(categoryDir, "2026-03-09");

    expect(next).toBe(5);
  });
});

test("writeDigestItems writes expected categorized file paths", async () => {
  await withTempDir(async (dir) => {
    const existingDir = path.join(dir, "research");
    await mkdir(existingDir, { recursive: true });
    await Bun.write(path.join(existingDir, "2026-03-09_2.md"), "existing");

    const items: DigestItem[] = [
      {
        category: "research",
        source: "slack",
        summary: "Gather customer interview notes.",
        keyPoints: ["Track themes"],
        references: [{ source: "slack", link: "https://example.com/notes" }],
      },
      {
        category: "planning",
        source: "git",
        summary: "Prepare implementation timeline.",
        keyPoints: [],
        references: [],
      },
      {
        category: "research",
        source: "figma",
        summary: "Investigate pricing benchmarks.",
        keyPoints: ["Compare plans"],
        references: [],
      },
    ];

    const written = await writeDigestItems({
      projectRoot: dir,
      items,
      now: new Date("2026-03-09T10:00:00Z"),
    });

    expect(written).toEqual([
      path.join(dir, "research", "2026-03-09_3.md"),
      path.join(dir, "planning", "2026-03-09_1.md"),
      path.join(dir, "research", "2026-03-09_4.md"),
    ]);

    const firstWritten = written[0];
    if (!firstWritten) {
      throw new Error("Expected at least one written digest file");
    }

    const writtenText = await Bun.file(firstWritten).text();
    expect(writtenText).toContain("## Summary");
    expect(writtenText).toContain("## Key Points");
    expect(writtenText).toContain("## References");
  });
});
