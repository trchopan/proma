import path from "node:path";
import readline from "node:readline/promises";

import {
  type DigestArgs,
  type ImportArgs,
  type MergeArgs,
  parseDigestCommandArgs,
  parseImportCommandArgs,
  parseMergeCommandArgs,
  parseReportCommandArgs,
  type ReportArgs,
} from "$/cli/args";
import {
  colorizeDiffPreview,
  renderDiffPreview,
  supportsAnsiColor,
} from "$/cli/diff-preview";
import { loadInputImages } from "$/cli/image-loader";
import {
  loadProjectConfig,
  resolveDigestAllowedSources,
  resolveGithubHost,
  resolveMcpServer,
} from "$/core/config";
import { createLogger, type Logger } from "$/core/logging";
import { createBuiltInPromptRegistry } from "$/core/prompting/registry";
import type { PromptRegistry } from "$/core/prompting/types";
import { validatePromptRegistry } from "$/core/prompting/validate";
import {
  generateDigestItems,
  generateMergeContent,
  generateTopicTarget,
} from "$/domain/digest/generate";
import type {
  DigestInputImage,
  MergeContentInput,
  MergeContentResult,
} from "$/domain/digest/types";
import { governTags } from "$/domain/merge/topic-merge";
import { generateReport, renderReportMarkdown } from "$/domain/report/report";
import {
  collectCategoryTagPool,
  type ImportedFile,
  listPendingDigestItems,
  listTopicCandidates,
  loadReportContext,
  markDigestItemMerged,
  prepareTopicMerge,
  rankTopicCandidates,
  resolveBaseReportFiles,
  resolveReportInputFiles,
  writeDigestItems,
  writeImportedMarkdown,
  writePreparedTopicMerge,
  writeReportFile,
} from "$/files";
import { callGithubTool, listGithubTools } from "$/integrations/github/client";
import {
  callMcpTool,
  listMcpTools,
  type McpTool,
} from "$/integrations/mcp/client";
import {
  renderActionList,
  renderImportedMarkdown,
} from "$/integrations/mcp/transform";

export {
  parseDigestCommandArgs,
  parseImportCommandArgs,
  parseMergeCommandArgs,
  parseReportCommandArgs,
  renderDiffPreview,
};

type CliDependencies = {
  loadProjectConfig: typeof loadProjectConfig;
  resolveDigestAllowedSources: typeof resolveDigestAllowedSources;
  resolveGithubHost: typeof resolveGithubHost;
  resolveMcpServer: typeof resolveMcpServer;
  generateDigestItems: typeof generateDigestItems;
  generateTopicTarget: typeof generateTopicTarget;
  generateMergeContent: typeof generateMergeContent;
  generateReport: typeof generateReport;
  writeDigestItems: typeof writeDigestItems;
  listPendingDigestItems: typeof listPendingDigestItems;
  markDigestItemMerged: typeof markDigestItemMerged;
  listTopicCandidates: typeof listTopicCandidates;
  rankTopicCandidates: typeof rankTopicCandidates;
  collectCategoryTagPool: typeof collectCategoryTagPool;
  prepareTopicMerge: typeof prepareTopicMerge;
  writePreparedTopicMerge: typeof writePreparedTopicMerge;
  listGithubTools: typeof listGithubTools;
  callGithubTool: typeof callGithubTool;
  listMcpTools: typeof listMcpTools;
  callMcpTool: typeof callMcpTool;
  renderActionList: typeof renderActionList;
  renderImportedMarkdown: typeof renderImportedMarkdown;
  writeImportedMarkdown: typeof writeImportedMarkdown;
  resolveReportInputFiles: typeof resolveReportInputFiles;
  resolveBaseReportFiles: typeof resolveBaseReportFiles;
  loadReportContext: typeof loadReportContext;
  writeReportFile: typeof writeReportFile;
  readTextFile: (filePath: string) => Promise<string>;
  confirmMerge: (targetPath: string, preview: string) => Promise<boolean>;
  createLogger: (options: {
    command: string;
    verbose: boolean;
    dryRun?: boolean;
    out: (message: string) => void;
    err: (message: string) => void;
  }) => Promise<Logger>;
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
    "  proma digest --input <file> --project <output-root> [--model <model>] [--config <file>] [--verbose] [--dry-run]",
    "  proma merge --project <output-root> [--model <model>] [--config <file>] [--verbose] [--dry-run] [--auto-merge]",
    "  proma import --server <github|mcp.<name>> (--list-actions | --tool <name> [--args <json>] [--output <file>]) [--config <file>] [--verbose] [--dry-run]",
    "  proma report --project <output-root> [--period <daily|weekly|bi-weekly|monthly>] [--input <file> ...] [--base <file> ...] [--model <model>] [--config <file>] [--verbose] [--dry-run]",
  ].join("\n");
}

function parseGlobalCliOptions(argv: string[]): {
  args: string[];
  verbose: boolean;
  dryRun: boolean;
  configPath: string;
  explicitConfigPath: boolean;
} {
  const args: string[] = [];
  let verbose = false;
  let dryRun = false;
  let rawConfigPath: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] ?? "";
    if (arg === "--verbose") {
      verbose = true;
      continue;
    }

    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }

    if (arg === "--config") {
      if (typeof rawConfigPath !== "undefined") {
        throw new Error("Duplicate argument: --config");
      }

      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("Missing value for --config");
      }

      rawConfigPath = value;
      index += 1;
      continue;
    }

    args.push(arg);
  }

  return {
    args,
    verbose,
    dryRun,
    configPath: path.resolve(process.cwd(), rawConfigPath ?? "proma.config.ts"),
    explicitConfigPath: typeof rawConfigPath !== "undefined",
  };
}

type ImportServerTarget =
  | {
      kind: "github";
    }
  | {
      kind: "mcp";
      name: string;
    };

function resolveImportServerTarget(server: string): ImportServerTarget {
  if (server === "github") {
    return { kind: "github" };
  }

  if (server.startsWith("mcp.")) {
    const name = server.slice("mcp.".length).trim();
    if (!name) {
      throw new Error(
        "Invalid --server value: mcp. (missing MCP server name; use mcp.<server_name>)",
      );
    }

    return {
      kind: "mcp",
      name,
    };
  }

  throw new Error(
    `Invalid --server value: ${server} (expected 'github' or 'mcp.<server_name>')`,
  );
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
  allowedSources: readonly string[],
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
      dryRun: parsed.dryRun,
      allowedSources,
    },
  );

  await logger.debug("digest.items_generated", "Generated digest items", {
    itemCount: items.length,
  });

  if (parsed.dryRun) {
    await logger.progress(
      "digest.dry_run",
      `Dry run complete. Would write ${items.length} digest file(s).`,
    );
    return 0;
  }

  await logger.progress("digest.write_notes", "Writing digest notes...");
  const digestNotes = await deps.writeDigestItems({
    projectRoot,
    items,
    allowedSources,
  });

  await logger.progress(
    "digest.write_complete",
    `Wrote ${digestNotes.length} digest file(s):`,
  );
  for (const digestNote of digestNotes) {
    await logger.info("digest.note_file", `- ${digestNote.absolutePath}`, {
      path: digestNote.absolutePath,
    });
  }

  return 0;
}

async function runMergeCommand(
  parsed: MergeArgs,
  deps: CliDependencies,
  logger: Logger,
  promptRegistry: PromptRegistry,
  allowedSources: readonly string[],
): Promise<number> {
  const projectRoot = path.resolve(parsed.project);
  await logger.progress(
    "merge.list_pending",
    "Scanning pending digest notes...",
  );
  const digestNotes = await deps.listPendingDigestItems(projectRoot, {
    allowedSources,
  });
  await logger.progress(
    "merge.pending_count",
    `Found ${digestNotes.length} pending digest file(s).`,
  );

  const mergedFiles: string[] = [];
  const skippedFiles: string[] = [];
  let completedStagedItems = 0;

  for (const digestNote of digestNotes) {
    await logger.debug("merge.process_item", "Processing digest note", {
      digestPath: digestNote.absolutePath,
      category: digestNote.item.category,
    });
    let hasSkippedMerge = false;
    const candidates = await deps.listTopicCandidates(
      projectRoot,
      digestNote.item.category,
      allowedSources,
    );
    await logger.debug("merge.candidates", "Loaded topic candidates", {
      category: digestNote.item.category,
      candidateCount: candidates.length,
    });
    const rankedCandidates = deps.rankTopicCandidates(
      digestNote.item,
      candidates,
      8,
    );
    const target = await deps.generateTopicTarget(
      digestNote.item,
      rankedCandidates,
      {
        model: parsed.model,
        logger,
        promptRegistry,
        dryRun: parsed.dryRun,
      },
    );
    await logger.debug("merge.target", "Generated topic routing target", {
      targetAction: target.action,
      targetSlug: target.slug ?? null,
    });
    const tagPool = deps.collectCategoryTagPool(candidates);
    const selectedCandidate =
      target.action === "update_existing"
        ? candidates.find((candidate) => candidate.slug === target.slug)
        : null;
    let mergeContentForPlan: MergeContentResult | undefined;
    let targetForMerge = {
      ...target,
      tags: governTags({
        existingTags: selectedCandidate?.tags ?? [],
        incomingTags: target.tags,
        tagPool,
      }),
    };

    if (!parsed.dryRun) {
      try {
        const mergeContentInput: MergeContentInput =
          digestNote.item.category === "discussion"
            ? {
                category: "discussion",
                topic: target.topic,
                tags: targetForMerge.tags,
                existing: {
                  summary: selectedCandidate?.summary ?? "",
                  contextBackground: selectedCandidate?.keyPoints ?? [],
                  resolution: [],
                  participants: [],
                  references: selectedCandidate?.references ?? [],
                },
                incoming: digestNote.item,
                tagPool,
              }
            : digestNote.item.category === "research"
              ? {
                  category: "research",
                  topic: target.topic,
                  tags: targetForMerge.tags,
                  existing: {
                    summary: selectedCandidate?.summary ?? "",
                    problemStatement: selectedCandidate?.keyPoints ?? [],
                    researchPlan: selectedCandidate?.timeline ?? [],
                    keyFindings: [],
                    personInCharge: [],
                    references: selectedCandidate?.references ?? [],
                  },
                  incoming: digestNote.item,
                  tagPool,
                }
              : {
                  category: "planning",
                  topic: target.topic,
                  tags: targetForMerge.tags,
                  existing: {
                    summary: selectedCandidate?.summary ?? "",
                    objectivesSuccessCriteria:
                      selectedCandidate?.keyPoints ?? [],
                    scope: [],
                    deliverables: [],
                    plan: [],
                    timeline: selectedCandidate?.timeline ?? [],
                    teamsIndividualsInvolved: [],
                    references: selectedCandidate?.references ?? [],
                  },
                  incoming: digestNote.item,
                  tagPool,
                };
        const merged = await deps.generateMergeContent(mergeContentInput, {
          model: parsed.model,
          logger,
          promptRegistry,
          dryRun: parsed.dryRun,
        });

        mergeContentForPlan = merged;
        targetForMerge = {
          ...targetForMerge,
          tags: governTags({
            existingTags: selectedCandidate?.tags ?? [],
            incomingTags: target.tags,
            aiTags: merged.tags,
            tagPool,
          }),
        };
      } catch (error) {
        await logger.debug(
          "merge.semantic_fallback",
          "Falling back to deterministic merge content",
          {
            reason: error instanceof Error ? error.message : "Unknown error",
          },
        );
      }
    }
    const mergedTopicPathsForStage: string[] = [];

    const plan = await deps.prepareTopicMerge({
      projectRoot,
      category: digestNote.item.category,
      item: digestNote.item,
      mergeContent: mergeContentForPlan,
      target: targetForMerge,
      mergedDigestId: digestNote.relativePath,
      allowedSources,
    });

    if (!plan.hasChanges) {
      await logger.progress(
        "merge.no_change",
        `No topic change: ${plan.targetPath}`,
      );
    } else {
      const preview = renderDiffPreview(
        plan.currentContent,
        plan.proposedContent,
      );
      let approved = true;
      if (!parsed.dryRun) {
        if (parsed.autoMerge) {
          await logger.progress(
            "merge.auto_merge.preview",
            `\nDiff preview for ${plan.targetPath}:`,
          );
          await logger.progress(
            "merge.auto_merge.preview_diff",
            supportsAnsiColor() ? colorizeDiffPreview(preview) : preview,
          );
        } else {
          approved = await deps.confirmMerge(plan.targetPath, preview);
        }
      }
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
      } else {
        if (parsed.dryRun) {
          await logger.progress(
            "merge.dry_run.plan",
            `Dry run: would merge into topic file: ${plan.targetPath}`,
          );
        } else {
          await deps.writePreparedTopicMerge(plan);
        }
        mergedFiles.push(plan.targetPath);
        mergedTopicPathsForStage.push(plan.relativeTargetPath);
        if (!parsed.dryRun) {
          await logger.progress(
            "merge.applied",
            `Merged into topic file: ${plan.targetPath}`,
          );
        }
      }
    }

    if (hasSkippedMerge) {
      continue;
    }

    if (parsed.dryRun) {
      completedStagedItems += 1;
      await logger.progress(
        "merge.dry_run.stage",
        `Dry run: would mark digest note as merged: ${digestNote.absolutePath}`,
      );
    } else {
      await deps.markDigestItemMerged(
        digestNote.absolutePath,
        mergedTopicPathsForStage,
        {
          allowedSources,
        },
      );
      completedStagedItems += 1;
      await logger.progress(
        "merge.marked_digest_note",
        `Marked digest note as merged: ${digestNote.absolutePath}`,
      );
    }
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
    `${parsed.dryRun ? "Would mark" : "Marked"} ${completedStagedItems} digest note(s) as merged.`,
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
    dryRun: parsed.dryRun,
  });

  if (parsed.dryRun) {
    await logger.progress(
      "report.dry_run",
      "Dry run complete. Would write generated report markdown file.",
    );
    return 0;
  }

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

async function runImportCommand(
  parsed: ImportArgs,
  projectConfig: Awaited<ReturnType<typeof loadProjectConfig>>,
  deps: CliDependencies,
  logger: Logger,
): Promise<number> {
  const target = resolveImportServerTarget(parsed.server);
  let mcpCommand: string[] | undefined;
  let githubHost: string | undefined;

  if (target.kind === "mcp") {
    const server = deps.resolveMcpServer(projectConfig, target.name);
    mcpCommand = server.command;
  } else if (!parsed.listActions) {
    githubHost = deps.resolveGithubHost(projectConfig);
  }

  if (parsed.listActions) {
    await logger.progress(
      "import.list_actions.start",
      `Listing actions for server: ${parsed.server}`,
    );

    if (parsed.dryRun) {
      await logger.progress(
        "import.list_actions.dry_run",
        `Dry run: would list actions for server '${parsed.server}'.`,
      );
      return 0;
    }

    const tools: McpTool[] =
      target.kind === "github"
        ? deps.listGithubTools()
        : await deps.listMcpTools({
            server: {
              command: mcpCommand ?? [],
            },
          });
    const rendered = deps.renderActionList({
      tools,
      server: parsed.server,
      verbose: parsed.verbose,
    });
    await logger.progress("import.list_actions.output", rendered);
    return 0;
  }

  const tool = parsed.tool;
  if (!tool) {
    throw new Error("Missing required argument: --tool");
  }

  await logger.progress(
    "import.call.start",
    `Calling MCP tool '${tool}' on server '${parsed.server}'...`,
  );

  if (parsed.dryRun) {
    if (parsed.output) {
      await logger.progress(
        "import.call.dry_run",
        `Dry run: would write imported markdown to ${path.resolve(parsed.output)}`,
      );
    } else {
      await logger.progress(
        "import.call.dry_run",
        "Dry run: would print imported markdown to stdout",
      );
    }
    return 0;
  }

  const result =
    target.kind === "github"
      ? await deps.callGithubTool({
          tool,
          args: parsed.args,
          host: githubHost,
        })
      : await deps.callMcpTool({
          server: {
            command: mcpCommand ?? [],
          },
          tool,
          args: parsed.args,
        });

  const markdown = deps.renderImportedMarkdown({
    server: parsed.server,
    tool,
    args: parsed.args,
    result,
  });

  if (parsed.output) {
    const written: ImportedFile = await deps.writeImportedMarkdown({
      output: parsed.output,
      markdown,
    });

    await logger.progress(
      "import.call.complete",
      `Wrote imported markdown: ${written.absolutePath}`,
    );
  } else {
    await logger.progress("import.call.output", markdown);
  }
  return 0;
}

export async function runCli(
  argv: string[],
  dependencies: Partial<CliDependencies> = {},
  io: Partial<CliIO> = {},
): Promise<number> {
  const deps: CliDependencies = {
    loadProjectConfig,
    resolveDigestAllowedSources,
    resolveGithubHost,
    resolveMcpServer,
    generateDigestItems,
    generateTopicTarget,
    generateMergeContent,
    generateReport,
    writeDigestItems,
    listPendingDigestItems,
    markDigestItemMerged,
    listTopicCandidates,
    rankTopicCandidates,
    collectCategoryTagPool,
    prepareTopicMerge,
    writePreparedTopicMerge,
    listGithubTools,
    callGithubTool,
    listMcpTools,
    callMcpTool,
    renderActionList,
    renderImportedMarkdown,
    writeImportedMarkdown,
    resolveReportInputFiles,
    resolveBaseReportFiles,
    loadReportContext,
    writeReportFile,
    readTextFile: defaultReadTextFile,
    confirmMerge: defaultConfirmMerge,
    createLogger,
    validatePromptRegistry,
    ...dependencies,
  };

  const terminal: CliIO = {
    out: console.log,
    err: console.error,
    ...io,
  };

  let globalOptions:
    | {
        args: string[];
        verbose: boolean;
        dryRun: boolean;
        configPath: string;
        explicitConfigPath: boolean;
      }
    | undefined;

  try {
    globalOptions = parseGlobalCliOptions(argv);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown argument parsing error";
    terminal.err(`Error: ${message}`);
    terminal.err(usage());
    return 1;
  }

  const normalizedArgvWithoutGlobalFlags = globalOptions.args;
  const hasGlobalVerbose = globalOptions.verbose;
  const hasGlobalDryRun = globalOptions.dryRun;

  const command = normalizedArgvWithoutGlobalFlags[0];
  if (
    command !== "digest" &&
    command !== "merge" &&
    command !== "import" &&
    command !== "report"
  ) {
    terminal.err(`Unknown command: ${command ?? "(none)"}`);
    terminal.err(usage());
    return 1;
  }

  const logger = await deps.createLogger({
    command,
    verbose: hasGlobalVerbose,
    dryRun: hasGlobalDryRun,
    out: terminal.out,
    err: terminal.err,
  });

  await logger.debug("cli.start", `Starting '${command}' command`, {
    argv,
    normalizedArgv: normalizedArgvWithoutGlobalFlags,
    logFilePath: logger.logFilePath,
    dryRun: hasGlobalDryRun,
  });
  if (!hasGlobalDryRun) {
    await logger.info("cli.log_path", `Writing logs to ${logger.logFilePath}`);
  }

  try {
    const projectConfig = await deps.loadProjectConfig(
      path.resolve(process.cwd()),
      {
        configPath: globalOptions.configPath,
        required: globalOptions.explicitConfigPath,
      },
    );

    if (command === "digest") {
      const parsed = {
        ...parseDigestCommandArgs(normalizedArgvWithoutGlobalFlags.slice(1)),
        dryRun: hasGlobalDryRun,
      };
      const allowedSources = deps.resolveDigestAllowedSources(projectConfig);
      const promptRegistry = createBuiltInPromptRegistry({
        allowedSources,
      });
      deps.validatePromptRegistry(promptRegistry);
      const exitCode = await runDigestCommand(
        parsed,
        deps,
        logger,
        promptRegistry,
        allowedSources,
      );
      await logger.debug("cli.complete", "Command completed successfully", {
        command,
      });
      return exitCode;
    }

    if (command === "report") {
      const parsed = {
        ...parseReportCommandArgs(normalizedArgvWithoutGlobalFlags.slice(1)),
        dryRun: hasGlobalDryRun,
      };
      const allowedSources = deps.resolveDigestAllowedSources(projectConfig);
      const promptRegistry = createBuiltInPromptRegistry({
        allowedSources,
      });
      deps.validatePromptRegistry(promptRegistry);
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

    if (command === "import") {
      const parsed = {
        ...parseImportCommandArgs(normalizedArgvWithoutGlobalFlags.slice(1)),
        dryRun: hasGlobalDryRun,
        verbose: hasGlobalVerbose,
      };

      const exitCode = await runImportCommand(
        parsed,
        projectConfig,
        deps,
        logger,
      );
      await logger.debug("cli.complete", "Command completed successfully", {
        command,
      });
      return exitCode;
    }

    const parsed = {
      ...parseMergeCommandArgs(normalizedArgvWithoutGlobalFlags.slice(1)),
      dryRun: hasGlobalDryRun,
    };
    const allowedSources = deps.resolveDigestAllowedSources(projectConfig);
    const promptRegistry = createBuiltInPromptRegistry({
      allowedSources,
    });
    deps.validatePromptRegistry(promptRegistry);
    const exitCode = await runMergeCommand(
      parsed,
      deps,
      logger,
      promptRegistry,
      allowedSources,
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
