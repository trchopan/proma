import path from "node:path";
import readline from "node:readline/promises";

import {
  type DigestArgs,
  type MergeArgs,
  parseDigestCommandArgs,
  parseMergeCommandArgs,
  parseReportCommandArgs,
  type ReportArgs,
} from "./cli/args";
import {
  colorizeDiffPreview,
  renderDiffPreview,
  supportsAnsiColor,
} from "./cli/diff-preview";
import { loadInputImages } from "./cli/image-loader";
import {
  type DigestInputImage,
  generateDigestItems,
  generateTopicTargets,
} from "./digest";
import {
  listPendingStageOneDigestItems,
  listTopicCandidates,
  loadReportContext,
  markStageOneDigestItemMerged,
  prepareTopicMerge,
  resolveBaseReportFiles,
  resolveReportInputFiles,
  writePreparedTopicMerge,
  writeReportFile,
  writeStageOneDigestItems,
} from "./files";
import { createLogger, type Logger } from "./logging";
import { loadPromptRegistry } from "./prompting/load";
import type { PromptRegistry } from "./prompting/types";
import { validatePromptRegistry } from "./prompting/validate";
import { generateReport, renderReportMarkdown } from "./report";

export {
  parseDigestCommandArgs,
  parseMergeCommandArgs,
  parseReportCommandArgs,
  renderDiffPreview,
};

type CliDependencies = {
  generateDigestItems: typeof generateDigestItems;
  generateTopicTargets: typeof generateTopicTargets;
  generateReport: typeof generateReport;
  writeStageOneDigestItems: typeof writeStageOneDigestItems;
  listPendingStageOneDigestItems: typeof listPendingStageOneDigestItems;
  markStageOneDigestItemMerged: typeof markStageOneDigestItemMerged;
  listTopicCandidates: typeof listTopicCandidates;
  prepareTopicMerge: typeof prepareTopicMerge;
  writePreparedTopicMerge: typeof writePreparedTopicMerge;
  resolveReportInputFiles: typeof resolveReportInputFiles;
  resolveBaseReportFiles: typeof resolveBaseReportFiles;
  loadReportContext: typeof loadReportContext;
  writeReportFile: typeof writeReportFile;
  readTextFile: (filePath: string) => Promise<string>;
  confirmMerge: (targetPath: string, preview: string) => Promise<boolean>;
  createLogger: (options: {
    command: string;
    verbose: boolean;
    out: (message: string) => void;
    err: (message: string) => void;
  }) => Promise<Logger>;
  loadPromptRegistry: (
    cwd?: string,
    configFileName?: string,
  ) => Promise<PromptRegistry>;
  validatePromptRegistry: (registry: PromptRegistry) => void;
};

type CliIO = {
  out: (message: string) => void;
  err: (message: string) => void;
};

function defaultReadTextFile(filePath: string): Promise<string> {
  return Bun.file(filePath).text();
}

function usage(): string {
  return [
    "Usage:",
    "  bun run index.ts digest --input <file> --project <output-root> [--model <model>] [--verbose]",
    "  bun run index.ts merge --project <output-root> [--model <model>] [--verbose]",
    "  bun run index.ts report --project <output-root> --period <daily|weekly|bi-weekly|monthly> [--input <file> ...] [--base <file> ...] [--model <model>] [--verbose]",
  ].join("\n");
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

async function runDigestCommand(
  parsed: DigestArgs,
  deps: CliDependencies,
  logger: Logger,
  promptRegistry: PromptRegistry,
): Promise<number> {
  const inputPath = path.resolve(parsed.input);
  const projectRoot = path.resolve(parsed.project);

  await logger.progress("digest.read_input", `Reading input: ${inputPath}`);
  const inputText = await deps.readTextFile(inputPath);
  await logger.debug("digest.input_loaded", "Loaded input text", {
    inputPath,
    inputBytes: inputText.length,
  });

  const images: DigestInputImage[] = await loadInputImages(
    inputText,
    inputPath,
    logger,
  );
  if (images.length > 0) {
    await logger.progress(
      "digest.images_loaded",
      `Loaded ${images.length} image(s) from input markdown.`,
    );
  }

  await logger.debug("digest.images_processed", "Processed markdown images", {
    imageCount: images.length,
    images: images.map((image) => image.label),
  });

  await logger.progress("digest.generate_items", "Generating digest items...");
  const items = await deps.generateDigestItems(
    {
      text: inputText,
      images,
    },
    {
      model: parsed.model,
      logger,
      promptRegistry,
    },
  );

  await logger.debug("digest.items_generated", "Generated digest items", {
    itemCount: items.length,
  });

  await logger.progress(
    "digest.write_stage_one",
    "Writing stage 1 digest notes...",
  );
  const stagedItems = await deps.writeStageOneDigestItems({
    projectRoot,
    items,
  });

  await logger.progress(
    "digest.write_complete",
    `Wrote ${stagedItems.length} stage 1 digest file(s):`,
  );
  for (const stagedItem of stagedItems) {
    await logger.info("digest.stage_file", `- ${stagedItem.absolutePath}`, {
      path: stagedItem.absolutePath,
    });
  }

  return 0;
}

async function runMergeCommand(
  parsed: MergeArgs,
  deps: CliDependencies,
  logger: Logger,
  promptRegistry: PromptRegistry,
): Promise<number> {
  const projectRoot = path.resolve(parsed.project);
  await logger.progress(
    "merge.list_pending",
    "Scanning pending staged notes...",
  );
  const stagedItems = await deps.listPendingStageOneDigestItems(projectRoot);
  await logger.progress(
    "merge.pending_count",
    `Found ${stagedItems.length} pending stage 1 digest file(s).`,
  );

  const mergedFiles: string[] = [];
  const skippedFiles: string[] = [];
  let completedStagedItems = 0;

  for (const stagedItem of stagedItems) {
    await logger.debug("merge.process_item", "Processing staged note", {
      stagedPath: stagedItem.absolutePath,
      category: stagedItem.item.category,
    });
    let hasSkippedMerge = false;
    const candidates = await deps.listTopicCandidates(
      projectRoot,
      stagedItem.item.category,
    );
    await logger.debug("merge.candidates", "Loaded topic candidates", {
      category: stagedItem.item.category,
      candidateCount: candidates.length,
    });
    const targets = await deps.generateTopicTargets(
      stagedItem.item,
      candidates,
      {
        model: parsed.model,
        logger,
        promptRegistry,
      },
    );
    await logger.debug("merge.targets", "Generated topic routing targets", {
      targetCount: targets.length,
    });

    for (const target of targets) {
      const plan = await deps.prepareTopicMerge({
        projectRoot,
        category: stagedItem.item.category,
        item: stagedItem.item,
        target,
      });

      if (!plan.hasChanges) {
        await logger.progress(
          "merge.no_change",
          `No topic change: ${plan.targetPath}`,
        );
        continue;
      }

      const preview = renderDiffPreview(
        plan.currentContent,
        plan.proposedContent,
      );
      const approved = await deps.confirmMerge(plan.targetPath, preview);
      await logger.debug("merge.confirmation", "Merge confirmation captured", {
        targetPath: plan.targetPath,
        approved,
      });

      if (!approved) {
        hasSkippedMerge = true;
        skippedFiles.push(plan.targetPath);
        await logger.progress(
          "merge.skipped",
          `Skipped merge: ${plan.targetPath}`,
        );
        continue;
      }

      await deps.writePreparedTopicMerge(plan);
      mergedFiles.push(plan.targetPath);
      await logger.progress(
        "merge.applied",
        `Merged into topic file: ${plan.targetPath}`,
      );
    }

    if (hasSkippedMerge) {
      continue;
    }

    await deps.markStageOneDigestItemMerged(stagedItem.absolutePath);
    completedStagedItems += 1;
    await logger.progress(
      "merge.marked_staged",
      `Marked staged note as merged: ${stagedItem.absolutePath}`,
    );
  }

  await logger.progress(
    "merge.summary.confirmed",
    `Confirmed ${mergedFiles.length} topic merge(s).`,
  );
  if (skippedFiles.length > 0) {
    await logger.progress(
      "merge.summary.skipped",
      `Skipped ${skippedFiles.length} topic merge(s).`,
    );
  }
  await logger.progress(
    "merge.summary.marked",
    `Marked ${completedStagedItems} staged note(s) as merged.`,
  );

  return 0;
}

async function runReportCommand(
  parsed: ReportArgs,
  deps: CliDependencies,
  logger: Logger,
  promptRegistry: PromptRegistry,
): Promise<number> {
  const projectRoot = path.resolve(parsed.project);

  await logger.progress(
    "report.resolve_input",
    "Resolving report input files...",
  );
  const inputFiles = await deps.resolveReportInputFiles(
    projectRoot,
    parsed.input,
  );
  await logger.progress(
    "report.input_count",
    `Resolved ${inputFiles.length} report input file(s).`,
  );

  await logger.progress(
    "report.resolve_base",
    "Resolving base report files...",
  );
  const baseFiles = await deps.resolveBaseReportFiles(projectRoot, parsed.base);
  await logger.progress(
    "report.base_count",
    `Resolved ${baseFiles.length} base report file(s).`,
  );

  await logger.progress("report.load_context", "Loading report context...");
  const context = await deps.loadReportContext({
    projectRoot,
    period: parsed.period,
    inputFiles,
    baseFiles,
  });

  await logger.progress("report.generate", "Generating report...");
  const generated = await deps.generateReport(context, {
    model: parsed.model,
    logger,
    promptRegistry,
  });

  await logger.progress("report.write", "Writing report file...");
  const markdown = renderReportMarkdown(generated);
  const written = await deps.writeReportFile({
    projectRoot,
    period: parsed.period,
    model: parsed.model,
    inputFiles,
    baseFiles,
    markdown,
  });

  await logger.progress(
    "report.complete",
    `Generated report: ${written.absolutePath}`,
  );

  return 0;
}

export async function runCli(
  argv: string[],
  dependencies: Partial<CliDependencies> = {},
  io: Partial<CliIO> = {},
): Promise<number> {
  const deps: CliDependencies = {
    generateDigestItems,
    generateTopicTargets,
    generateReport,
    writeStageOneDigestItems,
    listPendingStageOneDigestItems,
    markStageOneDigestItemMerged,
    listTopicCandidates,
    prepareTopicMerge,
    writePreparedTopicMerge,
    resolveReportInputFiles,
    resolveBaseReportFiles,
    loadReportContext,
    writeReportFile,
    readTextFile: defaultReadTextFile,
    confirmMerge: defaultConfirmMerge,
    createLogger,
    loadPromptRegistry,
    validatePromptRegistry,
    ...dependencies,
  };

  const terminal: CliIO = {
    out: console.log,
    err: console.error,
    ...io,
  };

  const hasGlobalVerbose = argv.includes("--verbose");
  const normalizedArgv = hasGlobalVerbose
    ? argv.filter((arg) => arg !== "--verbose")
    : argv;

  const command = normalizedArgv[0];
  if (command !== "digest" && command !== "merge" && command !== "report") {
    terminal.err(`Unknown command: ${command ?? "(none)"}`);
    terminal.err(usage());
    return 1;
  }

  const logger = await deps.createLogger({
    command,
    verbose: hasGlobalVerbose,
    out: terminal.out,
    err: terminal.err,
  });

  await logger.debug("cli.start", `Starting '${command}' command`, {
    argv,
    normalizedArgv,
    logFilePath: logger.logFilePath,
  });
  await logger.info("cli.log_path", `Writing logs to ${logger.logFilePath}`);

  try {
    const promptRegistry = await deps.loadPromptRegistry(process.cwd());
    deps.validatePromptRegistry(promptRegistry);

    if (command === "digest") {
      const parsed = parseDigestCommandArgs(normalizedArgv.slice(1));
      const exitCode = await runDigestCommand(
        parsed,
        deps,
        logger,
        promptRegistry,
      );
      await logger.debug("cli.complete", "Command completed successfully", {
        command,
      });
      return exitCode;
    }

    if (command === "report") {
      const parsed = parseReportCommandArgs(normalizedArgv.slice(1));
      const exitCode = await runReportCommand(
        parsed,
        deps,
        logger,
        promptRegistry,
      );
      await logger.debug("cli.complete", "Command completed successfully", {
        command,
      });
      return exitCode;
    }

    const parsed = parseMergeCommandArgs(normalizedArgv.slice(1));
    const exitCode = await runMergeCommand(
      parsed,
      deps,
      logger,
      promptRegistry,
    );
    await logger.debug("cli.complete", "Command completed successfully", {
      command,
    });
    return exitCode;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown CLI error";
    await logger.error("cli.error", `Error: ${message}`);
    await logger.error("cli.usage", usage());
    return 1;
  }
}
