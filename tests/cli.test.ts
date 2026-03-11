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
} from "$/cli";
import type { DigestItem } from "$/digest/types";

test("parseDigestCommandArgs parses required and optional args", () => {
  const parsed = parseDigestCommandArgs([
    "--input",
    "raw.md",
    "--project",
    "apollo",
    "--model",
    "gpt-4.1",
  ]);

  expect(parsed).toEqual({
    input: "raw.md",
    project: "apollo",
    model: "gpt-4.1",
    verbose: false,
    dryRun: false,
  });
});

test("parseDigestCommandArgs parses --verbose flag", () => {
  const parsed = parseDigestCommandArgs([
    "--input",
    "raw.md",
    "--project",
    "apollo",
    "--verbose",
  ]);

  expect(parsed).toEqual({
    input: "raw.md",
    project: "apollo",
    model: "gpt-5.2",
    verbose: true,
    dryRun: false,
  });
});

test("parseDigestCommandArgs parses --dry-run flag", () => {
  const parsed = parseDigestCommandArgs([
    "--input",
    "raw.md",
    "--project",
    "apollo",
    "--dry-run",
  ]);

  expect(parsed).toEqual({
    input: "raw.md",
    project: "apollo",
    model: "gpt-5.2",
    verbose: false,
    dryRun: true,
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
    dryRun: false,
  });
});

test("parseMergeCommandArgs parses --verbose flag", () => {
  const parsed = parseMergeCommandArgs(["--project", "apollo", "--verbose"]);

  expect(parsed).toEqual({
    project: "apollo",
    model: "gpt-5.2",
    verbose: true,
    dryRun: false,
  });
});

test("parseMergeCommandArgs parses --dry-run flag", () => {
  const parsed = parseMergeCommandArgs(["--project", "apollo", "--dry-run"]);

  expect(parsed).toEqual({
    project: "apollo",
    model: "gpt-5.2",
    verbose: false,
    dryRun: true,
  });
});

test("parseReportCommandArgs parses required and repeatable args", () => {
  const parsed = parseReportCommandArgs([
    "--project",
    "apollo",
    "--period",
    "weekly",
    "--input",
    "topics/planning/release.md",
    "--input",
    "topics/discussion/incident.md",
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
    input: ["topics/planning/release.md", "topics/discussion/incident.md"],
    base: ["reports/2026-03-08_weekly.md", "reports/2026-03-01_weekly.md"],
    model: "gpt-4.1",
    verbose: false,
    dryRun: false,
  });
});

test("parseReportCommandArgs defaults period to weekly", () => {
  const parsed = parseReportCommandArgs(["--project", "apollo"]);

  expect(parsed).toEqual({
    project: "apollo",
    period: "weekly",
    input: [],
    base: [],
    model: "gpt-5.2",
    verbose: false,
    dryRun: false,
  });
});

test("parseReportCommandArgs parses --dry-run flag", () => {
  const parsed = parseReportCommandArgs(["--project", "apollo", "--dry-run"]);

  expect(parsed).toEqual({
    project: "apollo",
    period: "weekly",
    input: [],
    base: [],
    model: "gpt-5.2",
    verbose: false,
    dryRun: true,
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

test("runCli report defaults period to weekly when omitted", async () => {
  let capturedContext: unknown;

  const exitCode = await runCli(
    ["report", "--project", "apollo"],
    {
      resolveReportInputFiles: async () => [],
      resolveBaseReportFiles: async () => [],
      loadReportContext: async (context) => {
        capturedContext = context;
        return {
          period: context.period,
          inputs: [],
          baseReports: [],
        };
      },
      generateReport: async () => ({
        title: "Weekly Report",
        executiveSummary: "Summary",
        updatedInformation: [],
        resolutions: [],
        nextSteps: [],
      }),
      writeReportFile: async () => ({
        absolutePath: "/tmp/apollo/reports/2026-03-10_weekly.md",
        relativePath: "reports/2026-03-10_weekly.md",
      }),
    },
    {
      out: () => {
        return;
      },
      err: () => {
        return;
      },
    },
  );

  expect(exitCode).toBe(0);
  expect(capturedContext).toEqual({
    projectRoot: expect.any(String),
    period: "weekly",
    inputFiles: [],
    baseFiles: [],
  });
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
      writeDigestItems: async () => [
        {
          item: mockItems[0] as DigestItem,
          absolutePath: "/tmp/apollo/notes/planning_2026-03-09_1.md",
          relativePath: "notes/planning_2026-03-09_1.md",
        },
      ],
      listPendingDigestItems: async () => {
        throw new Error("listPendingDigestItems should not be called");
      },
      markDigestItemMerged: async () => {
        throw new Error("markDigestItemMerged should not be called");
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
  expect(output).toContain("Wrote 1 digest file(s):");
});

test("runCli digest with --dry-run does not write stage 1 files", async () => {
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
    ["digest", "--input", "./input.txt", "--project", "apollo", "--dry-run"],
    {
      readTextFile: async () => "raw text",
      generateDigestItems: async () => mockItems,
      writeDigestItems: async () => {
        throw new Error("writeDigestItems should not be called");
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
  expect(output).toContain("Dry run complete. Would write 1 digest file(s).");
});

test("runCli merge processes pending digest notes", async () => {
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
      listPendingDigestItems: async () => [
        {
          item: mockItems[0] as DigestItem,
          absolutePath: "/tmp/apollo/notes/planning_2026-03-09_1.md",
          relativePath: "notes/planning_2026-03-09_1.md",
        },
      ],
      markDigestItemMerged: async (absolutePath) => {
        mergedStageNotes.push(absolutePath);
      },
      listTopicCandidates: async () => [],
      rankTopicCandidates: (_item, candidates) => candidates,
      collectCategoryTagPool: () => [],
      generateTopicTarget: async () => ({
        action: "create_new",
        shortDescription: "sprint-goals",
        topic: "Sprint Goals",
        tags: ["sprint"],
      }),
      generateMergeContent: async () => ({
        category: "planning",
        summary: "Plan sprint goals.",
        objectivesSuccessCriteria: ["Align scope"],
        scope: [],
        deliverables: [],
        plan: [],
        timeline: ["2026-03-09 - Sprint planning kickoff"],
        teamsIndividualsInvolved: [],
        references: [],
        tags: ["sprint"],
      }),
      prepareTopicMerge: async () => ({
        targetPath: "/tmp/apollo/topics/planning/sprint-goals.md",
        relativeTargetPath: "topics/planning/sprint-goals.md",
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
  expect(output).toContain("Found 1 pending digest file(s).");
  expect(output).toContain(
    "No topic change: /tmp/apollo/topics/planning/sprint-goals.md",
  );
  expect(output).toContain("Confirmed 0 topic merge(s).");
  expect(output).toContain("Marked 1 digest note(s) as merged.");
  expect(mergedStageNotes).toEqual([
    "/tmp/apollo/notes/planning_2026-03-09_1.md",
  ]);
});

test("runCli merge with --dry-run does not write files", async () => {
  const output: string[] = [];
  const mockItem: DigestItem = {
    category: "planning",
    source: "wiki",
    summary: "Plan sprint goals.",
    keyPoints: ["Align scope"],
    timeline: ["2026-03-09 - Sprint planning kickoff"],
    references: [],
  };

  const exitCode = await runCli(
    ["merge", "--project", "apollo", "--dry-run"],
    {
      listPendingDigestItems: async () => [
        {
          item: mockItem,
          absolutePath: "/tmp/apollo/notes/planning_2026-03-09_1.md",
          relativePath: "notes/planning_2026-03-09_1.md",
        },
      ],
      markDigestItemMerged: async () => {
        throw new Error("markDigestItemMerged should not be called");
      },
      listTopicCandidates: async () => [],
      rankTopicCandidates: (_item, candidates) => candidates,
      collectCategoryTagPool: () => [],
      generateTopicTarget: async () => ({
        action: "create_new",
        shortDescription: "sprint-goals",
        topic: "Sprint Goals",
        tags: ["sprint"],
      }),
      prepareTopicMerge: async () => ({
        targetPath: "/tmp/apollo/topics/planning/sprint-goals.md",
        relativeTargetPath: "topics/planning/sprint-goals.md",
        currentContent: "before",
        proposedContent: "after",
        isNew: false,
        hasChanges: true,
      }),
      confirmMerge: async () => {
        throw new Error("confirmMerge should not be called in dry run");
      },
      writePreparedTopicMerge: async () => {
        throw new Error("writePreparedTopicMerge should not be called");
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
  expect(output).toContain(
    "Dry run: would merge into topic file: /tmp/apollo/topics/planning/sprint-goals.md",
  );
  expect(output).toContain(
    "Dry run: would mark digest note as merged: /tmp/apollo/notes/planning_2026-03-09_1.md",
  );
  expect(output).toContain("Would mark 1 digest note(s) as merged.");
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
      "topics/planning/release.md",
      "--base",
      "reports/2026-03-08_weekly.md",
    ],
    {
      resolveReportInputFiles: async () => [
        "/tmp/apollo/topics/planning/release.md",
      ],
      resolveBaseReportFiles: async () => [
        "/tmp/apollo/reports/2026-03-08_weekly.md",
      ],
      loadReportContext: async () => ({
        period: "weekly",
        inputs: [
          {
            path: "topics/planning/release.md",
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

test("runCli report with --dry-run does not write report file", async () => {
  const output: string[] = [];

  const exitCode = await runCli(
    ["report", "--project", "apollo", "--dry-run"],
    {
      resolveReportInputFiles: async () => [],
      resolveBaseReportFiles: async () => [],
      loadReportContext: async () => ({
        period: "weekly",
        inputs: [],
        baseReports: [],
      }),
      generateReport: async () => ({
        title: "Weekly Report",
        executiveSummary: "Team made progress.",
        updatedInformation: ["Updated item"],
        resolutions: ["Resolved item"],
        nextSteps: ["Next item"],
      }),
      writeReportFile: async () => {
        throw new Error("writeReportFile should not be called");
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
  expect(output).toContain(
    "Dry run complete. Would write generated report markdown file.",
  );
});

test("renderDiffPreview renders unified hunks and change counts", () => {
  const current = [
    "---",
    "category: planning",
    "---",
    "# Sprint Goals",
    "## Summary",
    "Plan sprint goals.",
    "## Key Points",
    "- Align scope",
  ].join("\n");
  const proposed = [
    "---",
    "category: planning",
    "---",
    "# Sprint Goals",
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
  expect(preview).toContain("@@ -3,6 +3,7 @@");
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
      writeDigestItems: async () => [],
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
