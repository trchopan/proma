import { mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import {
  extractCanonicalTopicData,
  firstMeaningfulLine,
} from "../markdown/canonical-topic";
import {
  parseFrontMatter,
  parseScalarFrontMatterEntries,
  splitFrontMatter,
} from "../markdown/frontmatter";
import type {
  BaseReportContext,
  ReportContextPayload,
  ReportInputContext,
  ReportPeriod,
} from "../report";

type WriteReportFileOptions = {
  projectRoot: string;
  period: ReportPeriod;
  model: string;
  inputFiles: string[];
  baseFiles: string[];
  markdown: string;
  now?: Date;
};

type WrittenReportFile = {
  absolutePath: string;
  relativePath: string;
};

const REPORT_INPUT_CATEGORIES = ["planning", "research", "discussion"];

function toIsoDate(now: Date): string {
  return now.toISOString().slice(0, 10);
}

function ensureMarkdownPath(filePath: string, argumentName: string): void {
  if (!filePath.toLowerCase().endsWith(".md")) {
    throw new Error(`Invalid ${argumentName} file (must be .md): ${filePath}`);
  }
}

function dedupePreserveOrder(paths: string[]): string[] {
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const value of paths) {
    if (seen.has(value)) {
      continue;
    }
    seen.add(value);
    deduped.push(value);
  }
  return deduped;
}

async function ensureExistingFile(filePath: string, argumentName: string) {
  const file = Bun.file(filePath);
  if (!(await file.exists())) {
    throw new Error(`Missing ${argumentName} file: ${filePath}`);
  }
}

export async function resolveReportInputFiles(
  projectRoot: string,
  explicitInputFiles: string[],
): Promise<string[]> {
  if (explicitInputFiles.length > 0) {
    const resolved = dedupePreserveOrder(
      explicitInputFiles.map((filePath) => path.resolve(filePath)),
    );
    for (const filePath of resolved) {
      ensureMarkdownPath(filePath, "--input");
      await ensureExistingFile(filePath, "--input");
    }
    return resolved;
  }

  const discovered: string[] = [];
  for (const category of REPORT_INPUT_CATEGORIES) {
    const categoryDir = path.join(projectRoot, category);
    let entries: string[] = [];
    try {
      entries = await readdir(categoryDir);
    } catch {
      entries = [];
    }

    for (const fileName of entries.sort((left, right) =>
      left.localeCompare(right),
    )) {
      if (!fileName.endsWith(".md")) {
        continue;
      }
      discovered.push(path.join(categoryDir, fileName));
    }
  }

  return discovered;
}

export async function resolveBaseReportFiles(
  projectRoot: string,
  explicitBaseFiles: string[],
): Promise<string[]> {
  if (explicitBaseFiles.length > 0) {
    const resolved = dedupePreserveOrder(
      explicitBaseFiles.map((filePath) => path.resolve(filePath)),
    );
    for (const filePath of resolved) {
      ensureMarkdownPath(filePath, "--base");
      await ensureExistingFile(filePath, "--base");
    }
    return resolved;
  }

  const reportsDir = path.join(projectRoot, "reports");
  let entries: string[] = [];
  try {
    entries = await readdir(reportsDir);
  } catch {
    return [];
  }

  return entries
    .filter((fileName) => fileName.endsWith(".md"))
    .sort((left, right) => left.localeCompare(right))
    .map((fileName) => path.join(reportsDir, fileName));
}

function toRelativeOrAbsolute(
  projectRoot: string,
  absolutePath: string,
): string {
  const relative = path.relative(projectRoot, absolutePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return absolutePath;
  }
  return relative;
}

async function loadInputContext(
  projectRoot: string,
  absolutePath: string,
): Promise<ReportInputContext> {
  const markdown = await Bun.file(absolutePath).text();
  const parsed = parseFrontMatter(markdown);
  const canonical = extractCanonicalTopicData(parsed.body);
  const categoryHint =
    parsed.metadata.category ?? path.basename(path.dirname(absolutePath));
  const topicHint =
    parsed.metadata.topic?.trim() || path.basename(absolutePath, ".md");

  return {
    path: toRelativeOrAbsolute(projectRoot, absolutePath),
    category: categoryHint,
    topic: topicHint,
    summary: canonical.summary || firstMeaningfulLine(parsed.body),
    keyPoints: canonical.keyPoints,
    timeline: canonical.timeline,
    references: canonical.references.map((ref) => `${ref.source}: ${ref.link}`),
  };
}

async function loadBaseReportContext(
  projectRoot: string,
  absolutePath: string,
): Promise<BaseReportContext> {
  const markdown = await Bun.file(absolutePath).text();
  const { frontMatter, body } = splitFrontMatter(markdown);
  const scalarEntries = parseScalarFrontMatterEntries(frontMatter);
  const titleLine =
    body
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.startsWith("# ")) ?? "# Project report";

  return {
    path: toRelativeOrAbsolute(projectRoot, absolutePath),
    period: scalarEntries.get("period") ?? "unknown",
    generatedAt: scalarEntries.get("generated_at") ?? "",
    title: titleLine.replace(/^#\s+/, "").trim(),
    body,
  };
}

export async function loadReportContext(options: {
  projectRoot: string;
  period: ReportPeriod;
  inputFiles: string[];
  baseFiles: string[];
}): Promise<ReportContextPayload> {
  const inputs: ReportInputContext[] = [];
  for (const filePath of options.inputFiles) {
    try {
      inputs.push(await loadInputContext(options.projectRoot, filePath));
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown parse error";
      throw new Error(
        `Failed to parse report input file ${filePath}: ${message}`,
      );
    }
  }

  const baseReports: BaseReportContext[] = [];
  for (const filePath of options.baseFiles) {
    try {
      baseReports.push(
        await loadBaseReportContext(options.projectRoot, filePath),
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown parse error";
      throw new Error(
        `Failed to parse base report file ${filePath}: ${message}`,
      );
    }
  }

  return {
    period: options.period,
    inputs,
    baseReports,
  };
}

function yamlQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function renderReportFrontMatter(options: {
  period: ReportPeriod;
  generatedAt: string;
  model: string;
  inputFiles: string[];
  baseFiles: string[];
}): string {
  return [
    "---",
    `period: ${options.period}`,
    `generated_at: ${yamlQuote(options.generatedAt)}`,
    `model: ${yamlQuote(options.model)}`,
    "input_files:",
    ...options.inputFiles.map((filePath) => `  - ${yamlQuote(filePath)}`),
    "base_reports:",
    ...options.baseFiles.map((filePath) => `  - ${yamlQuote(filePath)}`),
    "---",
    "",
  ].join("\n");
}

async function allocateReportOutputPath(options: {
  reportsDir: string;
  datePart: string;
  period: ReportPeriod;
}): Promise<WrittenReportFile> {
  const baseName = `${options.datePart}_${options.period}`;
  const firstName = `${baseName}.md`;
  const firstPath = path.join(options.reportsDir, firstName);
  if (!(await Bun.file(firstPath).exists())) {
    return {
      absolutePath: firstPath,
      relativePath: path.join("reports", firstName),
    };
  }

  let index = 2;
  while (true) {
    const candidateName = `${baseName}_${index}.md`;
    const candidatePath = path.join(options.reportsDir, candidateName);
    if (!(await Bun.file(candidatePath).exists())) {
      return {
        absolutePath: candidatePath,
        relativePath: path.join("reports", candidateName),
      };
    }
    index += 1;
  }
}

export async function writeReportFile(
  options: WriteReportFileOptions,
): Promise<WrittenReportFile> {
  const reportsDir = path.join(options.projectRoot, "reports");
  const now = options.now ?? new Date();
  const generatedAt = now.toISOString();
  const datePart = toIsoDate(now);

  await mkdir(reportsDir, { recursive: true });
  const output = await allocateReportOutputPath({
    reportsDir,
    datePart,
    period: options.period,
  });

  const frontMatter = renderReportFrontMatter({
    period: options.period,
    generatedAt,
    model: options.model,
    inputFiles: options.inputFiles.map((filePath) =>
      toRelativeOrAbsolute(options.projectRoot, filePath),
    ),
    baseFiles: options.baseFiles.map((filePath) =>
      toRelativeOrAbsolute(options.projectRoot, filePath),
    ),
  });

  await Bun.write(output.absolutePath, `${frontMatter}${options.markdown}`);
  return output;
}
