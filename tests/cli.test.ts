import { expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  parseDigestCommandArgs,
  parseMergeCommandArgs,
  parseReportCommandArgs,
  renderDiffPreview,
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
    verbose: false,
  });
});

test("parseDigestCommandArgs parses --verbose flag", () => {
  const parsed = parseDigestCommandArgs([
    "--input",
    "notes.txt",
    "--project",
    "apollo",
    "--verbose",
  ]);

  expect(parsed).toEqual({
    input: "notes.txt",
    project: "apollo",
    model: "gpt-5.2",
    verbose: true,
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
    verbose: false,
  });
});

test("parseMergeCommandArgs parses --verbose flag", () => {
  const parsed = parseMergeCommandArgs(["--project", "apollo", "--verbose"]);

  expect(parsed).toEqual({
    project: "apollo",
    model: "gpt-5.2",
    verbose: true,
  });
});

test("parseReportCommandArgs parses required and repeatable args", () => {
  const parsed = parseReportCommandArgs([
    "--project",
    "apollo",
    "--period",
    "weekly",
    "--input",
    "planning/release.md",
    "--input",
    "discussion/incident.md",
    "--base",
    "reports/2026-03-08_weekly.md",
    "--base",
    "reports/2026-03-01_weekly.md",
    "--model",
    "gpt-4.1",
  ]);

  expect(parsed).toEqual({
    project: "apollo",
    period: "weekly",
    input: ["planning/release.md", "discussion/incident.md"],
    base: ["reports/2026-03-08_weekly.md", "reports/2026-03-01_weekly.md"],
    model: "gpt-4.1",
    verbose: false,
  });
});

test("parseReportCommandArgs rejects invalid period", () => {
  expect(() =>
    parseReportCommandArgs(["--project", "apollo", "--period", "quarterly"]),
  ).toThrow("Invalid --period value");
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

test("runCli report returns readable error for missing period arg", async () => {
  const errors: string[] = [];

  const exitCode = await runCli(
    ["report", "--project", "apollo"],
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
  expect(errors.join("\n")).toContain("Missing required argument: --period");
});

test("runCli digest writes stage 1 files only", async () => {
  const output: string[] = [];
  const mockItems: DigestItem[] = [
    {
      category: "planning",
      source: "wiki",
      summary: "Plan sprint goals.",
      keyPoints: ["Align scope"],
      timeline: ["2026-03-09 - Sprint planning kickoff"],
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
      timeline: ["2026-03-09 - Sprint planning kickoff"],
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

test("runCli report generates report and prints output path", async () => {
  const output: string[] = [];

  const exitCode = await runCli(
    [
      "report",
      "--project",
      "apollo",
      "--period",
      "weekly",
      "--input",
      "planning/release.md",
      "--base",
      "reports/2026-03-08_weekly.md",
    ],
    {
      resolveReportInputFiles: async () => ["/tmp/apollo/planning/release.md"],
      resolveBaseReportFiles: async () => [
        "/tmp/apollo/reports/2026-03-08_weekly.md",
      ],
      loadReportContext: async () => ({
        period: "weekly",
        inputs: [
          {
            path: "planning/release.md",
            category: "planning",
            topic: "Release Readiness",
            summary: "Summary",
            keyPoints: ["Point"],
            timeline: ["2026-03-09 - Update"],
            references: [],
          },
        ],
        baseReports: [],
      }),
      generateReport: async () => ({
        title: "Weekly Report",
        executiveSummary: "Team made progress.",
        updatedInformation: ["Updated item"],
        resolutions: ["Resolved item"],
        nextSteps: ["Next item"],
      }),
      writeReportFile: async () => ({
        absolutePath: "/tmp/apollo/reports/2026-03-09_weekly.md",
        relativePath: "reports/2026-03-09_weekly.md",
      }),
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
  expect(output).toContain("Resolved 1 report input file(s).");
  expect(output).toContain("Resolved 1 base report file(s).");
  expect(output).toContain(
    "Generated report: /tmp/apollo/reports/2026-03-09_weekly.md",
  );
});

test("renderDiffPreview renders unified hunks and change counts", () => {
  const current = [
    "---",
    'topic: "Sprint Goals"',
    "---",
    "## Summary",
    "Plan sprint goals.",
    "## Key Points",
    "- Align scope",
  ].join("\n");
  const proposed = [
    "---",
    'topic: "Sprint Goals"',
    "---",
    "## Summary",
    "Plan sprint goals with staffing detail.",
    "## Key Points",
    "- Align scope",
    "- Confirm owners",
  ].join("\n");

  const preview = renderDiffPreview(current, proposed);

  expect(preview).toContain("--- current");
  expect(preview).toContain("+++ proposed");
  expect(preview).toContain("Changes: +2 -1");
  expect(preview).toContain("@@ -2,6 +2,7 @@");
  expect(preview).toContain("- Plan sprint goals.");
  expect(preview).toContain("+ Plan sprint goals with staffing detail.");
  expect(preview).toContain("+ - Confirm owners");
});

test("renderDiffPreview reports no textual changes", () => {
  const content = ["## Summary", "Same text"].join("\n");

  const preview = renderDiffPreview(content, content);

  expect(preview).toContain("No textual changes.");
});

test("runCli digest loads markdown images and skips invalid ones with warnings", async () => {
  const output: string[] = [];
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "proma-digest-"));
  const inputPath = path.join(tmpDir, "notes.md");
  const imagePath = path.join(tmpDir, "image.png");

  await Bun.write(imagePath, new Uint8Array([137, 80, 78, 71]));

  const inputText = [
    "This is a text file with an image.",
    "",
    "![Valid image](image.png)",
    "![Missing image](missing.png)",
    "![Unsupported image](vector.svg)",
  ].join("\n");

  let capturedInput: unknown;
  const mockItems: DigestItem[] = [
    {
      category: "planning",
      source: "wiki",
      summary: "Plan sprint goals.",
      keyPoints: ["Align scope"],
      timeline: ["2026-03-09 - Sprint planning kickoff"],
      references: [],
    },
  ];

  const exitCode = await runCli(
    ["digest", "--input", inputPath, "--project", "apollo"],
    {
      readTextFile: async () => inputText,
      generateDigestItems: async (input) => {
        capturedInput = input;
        return mockItems;
      },
      writeStageOneDigestItems: async () => [],
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
  expect(output).toContain(
    "Warning: Skipping image 'missing.png' (file not found).",
  );
  expect(output).toContain(
    "Warning: Skipping image 'vector.svg' (unsupported type: .svg).",
  );
  expect(output).toContain("Loaded 1 image(s) from input markdown.");

  expect(capturedInput).toEqual({
    text: inputText,
    images: [
      {
        label: "image.png",
        url: expect.stringMatching(/^data:image\/png;base64,/),
      },
    ],
  });
});
