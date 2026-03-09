import path from "node:path";
import readline from "node:readline/promises";

import { generateDigestItems, generateTopicTargets } from "./digest";
import {
  listPendingStageOneDigestItems,
  listTopicCandidates,
  markStageOneDigestItemMerged,
  prepareTopicMerge,
  writePreparedTopicMerge,
  writeStageOneDigestItems,
} from "./files";

type CliDependencies = {
  generateDigestItems: typeof generateDigestItems;
  generateTopicTargets: typeof generateTopicTargets;
  writeStageOneDigestItems: typeof writeStageOneDigestItems;
  listPendingStageOneDigestItems: typeof listPendingStageOneDigestItems;
  markStageOneDigestItemMerged: typeof markStageOneDigestItemMerged;
  listTopicCandidates: typeof listTopicCandidates;
  prepareTopicMerge: typeof prepareTopicMerge;
  writePreparedTopicMerge: typeof writePreparedTopicMerge;
  readTextFile: (filePath: string) => Promise<string>;
  confirmMerge: (targetPath: string, preview: string) => Promise<boolean>;
};

type CliIO = {
  out: (message: string) => void;
  err: (message: string) => void;
};

type DigestArgs = {
  input: string;
  project: string;
  model: string;
};

type MergeArgs = {
  project: string;
  model: string;
};

const DEFAULT_MODEL = "gpt-5.2";

function defaultReadTextFile(filePath: string): Promise<string> {
  return Bun.file(filePath).text();
}

function usage(): string {
  return [
    "Usage:",
    "  bun run index.ts digest --input <file> --project <output-root> [--model <model>]",
    "  bun run index.ts merge --project <output-root> [--model <model>]",
  ].join("\n");
}

type DiffOp = {
  type: "context" | "add" | "remove";
  text: string;
  oldLine: number | null;
  newLine: number | null;
};

function splitLinesForDiff(content: string): string[] {
  if (content.length === 0) {
    return [];
  }

  const lines = content.split("\n");
  if (content.endsWith("\n") && lines[lines.length - 1] === "") {
    lines.pop();
  }
  return lines;
}

function computeLineDiff(
  currentLines: string[],
  proposedLines: string[],
): DiffOp[] {
  const currentCount = currentLines.length;
  const proposedCount = proposedLines.length;
  const lcs: number[][] = Array.from({ length: currentCount + 1 }, () =>
    Array(proposedCount + 1).fill(0),
  );

  for (let i = currentCount - 1; i >= 0; i -= 1) {
    const row = lcs[i];
    const nextRow = lcs[i + 1];
    if (!row) {
      continue;
    }
    for (let j = proposedCount - 1; j >= 0; j -= 1) {
      if (currentLines[i] === proposedLines[j]) {
        row[j] = (nextRow?.[j + 1] ?? 0) + 1;
      } else {
        row[j] = Math.max(nextRow?.[j] ?? 0, row[j + 1] ?? 0);
      }
    }
  }

  const operations: DiffOp[] = [];
  let currentIndex = 0;
  let proposedIndex = 0;

  while (currentIndex < currentCount || proposedIndex < proposedCount) {
    const currentLine = currentLines[currentIndex];
    const proposedLine = proposedLines[proposedIndex];

    if (
      currentIndex < currentCount &&
      proposedIndex < proposedCount &&
      currentLine === proposedLine
    ) {
      operations.push({
        type: "context",
        text: currentLine ?? "",
        oldLine: currentIndex + 1,
        newLine: proposedIndex + 1,
      });
      currentIndex += 1;
      proposedIndex += 1;
      continue;
    }

    const addScore = lcs[currentIndex]?.[proposedIndex + 1] ?? -1;
    const removeScore = lcs[currentIndex + 1]?.[proposedIndex] ?? -1;

    if (proposedIndex < proposedCount && addScore >= removeScore) {
      operations.push({
        type: "add",
        text: proposedLine ?? "",
        oldLine: null,
        newLine: proposedIndex + 1,
      });
      proposedIndex += 1;
      continue;
    }

    if (currentIndex < currentCount) {
      operations.push({
        type: "remove",
        text: currentLine ?? "",
        oldLine: currentIndex + 1,
        newLine: null,
      });
      currentIndex += 1;
    }
  }

  return operations;
}

function getHunkStartLine(
  operations: DiffOp[],
  hunkStart: number,
  key: "oldLine" | "newLine",
): number {
  for (let i = hunkStart; i < operations.length; i += 1) {
    const lineNumber = operations[i]?.[key];
    if (lineNumber !== null && lineNumber !== undefined) {
      return lineNumber;
    }
  }

  for (let i = hunkStart - 1; i >= 0; i -= 1) {
    const lineNumber = operations[i]?.[key];
    if (lineNumber !== null && lineNumber !== undefined) {
      return lineNumber + 1;
    }
  }

  return 1;
}

export function renderDiffPreview(
  currentContent: string,
  proposedContent: string,
): string {
  const currentLines = splitLinesForDiff(currentContent);
  const proposedLines = splitLinesForDiff(proposedContent);
  const operations = computeLineDiff(currentLines, proposedLines);
  const contextWindow = 3;
  const changeIndices = operations
    .map((operation, index) => (operation.type === "context" ? null : index))
    .filter((index): index is number => index !== null);

  const addedCount = operations.filter(
    (operation) => operation.type === "add",
  ).length;
  const removedCount = operations.filter(
    (operation) => operation.type === "remove",
  ).length;

  if (changeIndices.length === 0) {
    return ["--- current", "+++ proposed", "No textual changes."].join("\n");
  }

  const hunkRanges: Array<{ start: number; end: number }> = [];
  const firstChange = changeIndices[0] ?? 0;
  let rangeStart = Math.max(firstChange - contextWindow, 0);
  let rangeEnd = Math.min(firstChange + contextWindow, operations.length - 1);

  for (let i = 1; i < changeIndices.length; i += 1) {
    const index = changeIndices[i] ?? 0;
    const nextStart = Math.max(index - contextWindow, 0);
    const nextEnd = Math.min(index + contextWindow, operations.length - 1);

    if (nextStart <= rangeEnd + 1) {
      rangeEnd = Math.max(rangeEnd, nextEnd);
      continue;
    }

    hunkRanges.push({ start: rangeStart, end: rangeEnd });
    rangeStart = nextStart;
    rangeEnd = nextEnd;
  }
  hunkRanges.push({ start: rangeStart, end: rangeEnd });

  const output: string[] = [
    "--- current",
    "+++ proposed",
    `Changes: +${addedCount} -${removedCount}`,
  ];

  for (const hunk of hunkRanges) {
    const hunkOperations = operations.slice(hunk.start, hunk.end + 1);
    const oldStart = getHunkStartLine(operations, hunk.start, "oldLine");
    const newStart = getHunkStartLine(operations, hunk.start, "newLine");
    const oldCount = hunkOperations.filter(
      (operation) => operation.oldLine !== null,
    ).length;
    const newCount = hunkOperations.filter(
      (operation) => operation.newLine !== null,
    ).length;

    output.push(`@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`);

    for (const operation of hunkOperations) {
      const marker =
        operation.type === "add"
          ? "+"
          : operation.type === "remove"
            ? "-"
            : " ";
      output.push(`${marker} ${operation.text}`);
    }
  }

  return output.join("\n");
}

function supportsAnsiColor(): boolean {
  return Boolean(process.stdout.isTTY) && process.env.NO_COLOR === undefined;
}

function colorizeDiffPreview(preview: string): string {
  const ANSI = {
    dim: "\u001b[2m",
    red: "\u001b[31m",
    green: "\u001b[32m",
    cyan: "\u001b[36m",
    reset: "\u001b[0m",
  };

  return preview
    .split("\n")
    .map((line) => {
      if (line.startsWith("@@")) {
        return `${ANSI.cyan}${line}${ANSI.reset}`;
      }
      if (line.startsWith("---") || line.startsWith("+++")) {
        return `${ANSI.dim}${line}${ANSI.reset}`;
      }
      if (line.startsWith("+ ")) {
        return `${ANSI.green}${line}${ANSI.reset}`;
      }
      if (line.startsWith("- ")) {
        return `${ANSI.red}${line}${ANSI.reset}`;
      }
      return line;
    })
    .join("\n");
}

async function defaultConfirmMerge(
  targetPath: string,
  preview: string,
): Promise<boolean> {
  console.log(`\nDiff preview for ${targetPath}:`);
  console.log(supportsAnsiColor() ? colorizeDiffPreview(preview) : preview);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    const answer = await rl.question("Apply this merge? [y/N] ");
    return answer.trim().toLowerCase() === "y";
  } finally {
    rl.close();
  }
}

function parseOptionValues(args: string[]): Map<string, string> {
  const values = new Map<string, string>();

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i] ?? "";
    if (!arg.startsWith("--")) {
      continue;
    }

    const value = args[i + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for ${arg}`);
    }

    values.set(arg, value);
    i += 1;
  }

  return values;
}

export function parseDigestCommandArgs(args: string[]): DigestArgs {
  const values = parseOptionValues(args);
  const input = values.get("--input");
  const project = values.get("--project");
  const model = values.get("--model") ?? DEFAULT_MODEL;

  if (!input) {
    throw new Error("Missing required argument: --input");
  }

  if (!project) {
    throw new Error("Missing required argument: --project");
  }

  return { input, project, model };
}

export function parseMergeCommandArgs(args: string[]): MergeArgs {
  const values = parseOptionValues(args);
  const project = values.get("--project");
  const model = values.get("--model") ?? DEFAULT_MODEL;

  if (!project) {
    throw new Error("Missing required argument: --project");
  }

  return { project, model };
}

export async function runCli(
  argv: string[],
  dependencies: Partial<CliDependencies> = {},
  io: Partial<CliIO> = {},
): Promise<number> {
  const deps: CliDependencies = {
    generateDigestItems,
    generateTopicTargets,
    writeStageOneDigestItems,
    listPendingStageOneDigestItems,
    markStageOneDigestItemMerged,
    listTopicCandidates,
    prepareTopicMerge,
    writePreparedTopicMerge,
    readTextFile: defaultReadTextFile,
    confirmMerge: defaultConfirmMerge,
    ...dependencies,
  };
  const terminal: CliIO = {
    out: console.log,
    err: console.error,
    ...io,
  };

  const command = argv[0];
  if (command !== "digest" && command !== "merge") {
    terminal.err(`Unknown command: ${command ?? "(none)"}`);
    terminal.err(usage());
    return 1;
  }

  try {
    if (command === "digest") {
      const parsed = parseDigestCommandArgs(argv.slice(1));
      const inputPath = path.resolve(parsed.input);
      const projectRoot = path.resolve(parsed.project);
      const inputText = await deps.readTextFile(inputPath);
      const items = await deps.generateDigestItems(inputText, {
        model: parsed.model,
      });
      const stagedItems = await deps.writeStageOneDigestItems({
        projectRoot,
        items,
      });

      terminal.out(`Wrote ${stagedItems.length} stage 1 digest file(s):`);
      for (const stagedItem of stagedItems) {
        terminal.out(`- ${stagedItem.absolutePath}`);
      }

      return 0;
    }

    const parsed = parseMergeCommandArgs(argv.slice(1));
    const projectRoot = path.resolve(parsed.project);
    const stagedItems = await deps.listPendingStageOneDigestItems(projectRoot);
    terminal.out(`Found ${stagedItems.length} pending stage 1 digest file(s).`);

    const mergedFiles: string[] = [];
    const skippedFiles: string[] = [];
    let completedStagedItems = 0;

    for (const stagedItem of stagedItems) {
      let hasSkippedMerge = false;
      const candidates = await deps.listTopicCandidates(
        projectRoot,
        stagedItem.item.category,
      );
      const targets = await deps.generateTopicTargets(
        stagedItem.item,
        candidates,
        {
          model: parsed.model,
        },
      );

      for (const target of targets) {
        const plan = await deps.prepareTopicMerge({
          projectRoot,
          category: stagedItem.item.category,
          item: stagedItem.item,
          target,
        });

        if (!plan.hasChanges) {
          terminal.out(`No topic change: ${plan.targetPath}`);
          continue;
        }

        const preview = renderDiffPreview(
          plan.currentContent,
          plan.proposedContent,
        );
        const approved = await deps.confirmMerge(plan.targetPath, preview);

        if (!approved) {
          hasSkippedMerge = true;
          skippedFiles.push(plan.targetPath);
          terminal.out(`Skipped merge: ${plan.targetPath}`);
          continue;
        }

        await deps.writePreparedTopicMerge(plan);
        mergedFiles.push(plan.targetPath);
        terminal.out(`Merged into topic file: ${plan.targetPath}`);
      }

      if (hasSkippedMerge) {
        continue;
      }

      await deps.markStageOneDigestItemMerged(stagedItem.absolutePath);
      completedStagedItems += 1;
      terminal.out(`Marked staged note as merged: ${stagedItem.absolutePath}`);
    }

    terminal.out(`Confirmed ${mergedFiles.length} topic merge(s).`);
    if (skippedFiles.length > 0) {
      terminal.out(`Skipped ${skippedFiles.length} topic merge(s).`);
    }
    terminal.out(`Marked ${completedStagedItems} staged note(s) as merged.`);

    return 0;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown CLI error";
    terminal.err(`Error: ${message}`);
    terminal.err(usage());
    return 1;
  }
}
