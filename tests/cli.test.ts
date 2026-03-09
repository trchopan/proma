import { expect, test } from "bun:test";

import {
  parseDigestCommandArgs,
  parseMergeCommandArgs,
  runCli,
} from "../src/cli";
import type { DigestItem } from "../src/digest";

test("parseDigestCommandArgs parses required and optional args", () => {
  const parsed = parseDigestCommandArgs([
    "--input",
    "notes.txt",
    "--project",
    "apollo",
    "--model",
    "gpt-4.1",
  ]);

  expect(parsed).toEqual({
    input: "notes.txt",
    project: "apollo",
    model: "gpt-4.1",
  });
});

test("parseMergeCommandArgs parses required and optional args", () => {
  const parsed = parseMergeCommandArgs([
    "--project",
    "apollo",
    "--model",
    "gpt-4.1",
  ]);

  expect(parsed).toEqual({
    project: "apollo",
    model: "gpt-4.1",
  });
});

test("runCli returns readable error for missing args", async () => {
  const errors: string[] = [];

  const exitCode = await runCli(
    ["digest", "--project", "apollo"],
    {},
    {
      out: () => {
        return;
      },
      err: (message) => {
        errors.push(message);
      },
    },
  );

  expect(exitCode).toBe(1);
  expect(errors.join("\n")).toContain("Missing required argument: --input");
});

test("runCli returns readable error for missing project arg", async () => {
  const errors: string[] = [];

  const exitCode = await runCli(
    ["digest", "--input", "./input.txt"],
    {},
    {
      out: () => {
        return;
      },
      err: (message) => {
        errors.push(message);
      },
    },
  );

  expect(exitCode).toBe(1);
  expect(errors.join("\n")).toContain("Missing required argument: --project");
});

test("runCli merge returns readable error for missing project arg", async () => {
  const errors: string[] = [];

  const exitCode = await runCli(
    ["merge"],
    {},
    {
      out: () => {
        return;
      },
      err: (message) => {
        errors.push(message);
      },
    },
  );

  expect(exitCode).toBe(1);
  expect(errors.join("\n")).toContain("Missing required argument: --project");
});

test("runCli digest writes stage 1 files only", async () => {
  const output: string[] = [];
  const mockItems: DigestItem[] = [
    {
      category: "planning",
      source: "wiki",
      summary: "Plan sprint goals.",
      keyPoints: ["Align scope"],
      references: [],
    },
  ];

  const exitCode = await runCli(
    ["digest", "--input", "./input.txt", "--project", "apollo"],
    {
      readTextFile: async () => "raw text",
      generateDigestItems: async () => mockItems,
      writeStageOneDigestItems: async () => [
        {
          item: mockItems[0] as DigestItem,
          absolutePath: "/tmp/apollo/notes/planning_2026-03-09_1.md",
          relativePath: "notes/planning_2026-03-09_1.md",
        },
      ],
      listPendingStageOneDigestItems: async () => {
        throw new Error("listPendingStageOneDigestItems should not be called");
      },
      markStageOneDigestItemMerged: async () => {
        throw new Error("markStageOneDigestItemMerged should not be called");
      },
    },
    {
      out: (message) => {
        output.push(message);
      },
      err: () => {
        return;
      },
    },
  );

  expect(exitCode).toBe(0);
  expect(output).toContain("Wrote 1 stage 1 digest file(s):");
});

test("runCli merge processes pending staged notes", async () => {
  const output: string[] = [];
  const mockItems: DigestItem[] = [
    {
      category: "planning",
      source: "wiki",
      summary: "Plan sprint goals.",
      keyPoints: ["Align scope"],
      references: [],
    },
  ];

  const mergedStageNotes: string[] = [];

  const exitCode = await runCli(
    ["merge", "--project", "apollo"],
    {
      listPendingStageOneDigestItems: async () => [
        {
          item: mockItems[0] as DigestItem,
          absolutePath: "/tmp/apollo/notes/planning_2026-03-09_1.md",
          relativePath: "notes/planning_2026-03-09_1.md",
        },
      ],
      markStageOneDigestItemMerged: async (absolutePath) => {
        mergedStageNotes.push(absolutePath);
      },
      listTopicCandidates: async () => [],
      generateTopicTargets: async () => [
        {
          action: "create_new",
          shortDescription: "sprint-goals",
          topic: "Sprint Goals",
          tags: ["sprint"],
        },
      ],
      prepareTopicMerge: async () => ({
        targetPath: "/tmp/apollo/planning/sprint-goals.md",
        relativeTargetPath: "planning/sprint-goals.md",
        currentContent: "same",
        proposedContent: "same",
        isNew: false,
        hasChanges: false,
      }),
      confirmMerge: async () => {
        throw new Error("confirmMerge should not be called for no-op merges");
      },
    },
    {
      out: (message) => {
        output.push(message);
      },
      err: () => {
        return;
      },
    },
  );

  expect(exitCode).toBe(0);
  expect(output).toContain("Found 1 pending stage 1 digest file(s).");
  expect(output).toContain(
    "No topic change: /tmp/apollo/planning/sprint-goals.md",
  );
  expect(output).toContain("Confirmed 0 topic merge(s).");
  expect(output).toContain("Marked 1 staged note(s) as merged.");
  expect(mergedStageNotes).toEqual([
    "/tmp/apollo/notes/planning_2026-03-09_1.md",
  ]);
});
