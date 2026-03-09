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

function renderDiffPreview(
  currentContent: string,
  proposedContent: string,
): string {
  const currentLines = currentContent.split("\n");
  const proposedLines = proposedContent.split("\n");

  return [
    "--- current",
    ...currentLines.map((line) => `- ${line}`),
    "+++ proposed",
    ...proposedLines.map((line) => `+ ${line}`),
  ].join("\n");
}

async function defaultConfirmMerge(
  targetPath: string,
  preview: string,
): Promise<boolean> {
  console.log(`\nDiff preview for ${targetPath}:`);
  console.log(preview);

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
