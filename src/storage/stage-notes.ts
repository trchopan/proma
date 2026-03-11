import { mkdir, readdir } from "node:fs/promises";
import path from "node:path";

import {
  DIGEST_CATEGORIES,
  DIGEST_SOURCES,
  type DigestCategory,
  type DigestItem,
  type DigestSource,
  renderDigestMarkdown,
} from "../digest";
import { extractCanonicalTopicData } from "../markdown/canonical-topic";
import {
  parseScalarFrontMatterEntries,
  splitFrontMatter,
} from "../markdown/frontmatter";

export type WriteStageOneDigestItemsOptions = {
  projectRoot: string;
  items: DigestItem[];
  now?: Date;
};

export type StagedDigestItem = {
  item: DigestItem;
  absolutePath: string;
  relativePath: string;
};

type StageOneFrontMatter = {
  category: DigestCategory;
  source: DigestSource;
  merged: boolean;
  merged_topic_paths: string[];
};

function parseArrayItemValue(raw: string): string {
  return raw.trim().replace(/^['"]|['"]$/g, "");
}

function parseFrontMatterStringArray(
  frontMatter: string,
  key: string,
): string[] {
  const lines = frontMatter.split("\n");

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    const match = line.match(/^\s*([a-z_]+):\s*(.*)$/);
    if (!match || match[1] !== key) {
      continue;
    }

    const inlineValue = (match[2] ?? "").trim();
    if (inlineValue.length > 0) {
      if (!inlineValue.startsWith("[") || !inlineValue.endsWith("]")) {
        return [];
      }

      const inner = inlineValue.slice(1, -1).trim();
      if (inner.length === 0) {
        return [];
      }

      return inner
        .split(",")
        .map(parseArrayItemValue)
        .filter((value) => value.length > 0);
    }

    const values: string[] = [];
    for (let j = i + 1; j < lines.length; j += 1) {
      const itemLine = lines[j] ?? "";
      const itemMatch = itemLine.match(/^\s*-\s+(.+)$/);
      if (!itemMatch?.[1]) {
        break;
      }

      const value = parseArrayItemValue(itemMatch[1]);
      if (value.length > 0) {
        values.push(value);
      }
      i = j;
    }

    return values;
  }

  return [];
}

function toDateString(now: Date): string {
  return now.toISOString().slice(0, 10);
}

function parseIndex(fileName: string, prefix: string): number | null {
  const matcher = new RegExp(`^${prefix}_(\\d+)\\.md$`);
  const match = fileName.match(matcher);
  if (!match?.[1]) {
    return null;
  }

  const parsed = Number.parseInt(match[1], 10);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  return parsed;
}

export async function allocateNextIndex(
  directoryPath: string,
  prefix: string,
): Promise<number> {
  let files: string[] = [];

  try {
    files = await readdir(directoryPath);
  } catch {
    return 1;
  }

  let maxIndex = 0;
  for (const fileName of files) {
    const index = parseIndex(fileName, prefix);
    if (index && index > maxIndex) {
      maxIndex = index;
    }
  }

  return maxIndex + 1;
}

function buildStageOneRelativePath(
  category: DigestCategory,
  datePrefix: string,
  index: number,
): string {
  return path.join("notes", `${category}_${datePrefix}_${index}.md`);
}

function parseDigestCategory(input: string): DigestCategory | null {
  const value = input.trim().toLowerCase();
  return (DIGEST_CATEGORIES as readonly string[]).includes(value)
    ? (value as DigestCategory)
    : null;
}

function parseDigestSource(input: string): DigestSource | null {
  const value = input.trim().toLowerCase();

  if (value === "figma" || value === "file") {
    return "document";
  }

  return (DIGEST_SOURCES as readonly string[]).includes(value)
    ? (value as DigestSource)
    : null;
}

function parseStageOneFrontMatter(
  markdown: string,
): StageOneFrontMatter | null {
  const { frontMatter } = splitFrontMatter(markdown);
  const entries = parseScalarFrontMatterEntries(frontMatter);

  const frontMatterCategory = entries.get("category");
  const category = frontMatterCategory
    ? parseDigestCategory(frontMatterCategory)
    : null;

  if (!category) {
    return null;
  }

  const frontMatterSource = entries.get("source");
  const source = frontMatterSource
    ? parseDigestSource(frontMatterSource)
    : null;

  if (!source) {
    return null;
  }

  const mergedRaw = entries.get("merged");
  if (!mergedRaw) {
    return null;
  }

  const mergedLower = mergedRaw.toLowerCase();
  if (mergedLower !== "true" && mergedLower !== "false") {
    return null;
  }

  const merged = mergedLower === "true";

  return {
    category,
    source,
    merged,
    merged_topic_paths: parseFrontMatterStringArray(
      frontMatter,
      "merged_topic_paths",
    ),
  };
}

function renderStageOneFrontMatter(metadata: StageOneFrontMatter): string {
  return [
    "---",
    `category: ${metadata.category}`,
    `source: ${metadata.source}`,
    `merged: ${metadata.merged ? "true" : "false"}`,
    "merged_topic_paths:",
    ...metadata.merged_topic_paths.map((topicPath) => `  - '${topicPath}'`),
    "---",
    "",
  ].join("\n");
}

function renderStageOneDigestFile(
  item: DigestItem,
  merged: boolean,
  mergedTopicPaths: string[],
): string {
  return `${renderStageOneFrontMatter({
    category: item.category,
    source: item.source,
    merged,
    merged_topic_paths: [...new Set(mergedTopicPaths)],
  })}${renderDigestMarkdown(item)}`;
}

function parseStageOneDigestItem(
  markdown: string,
  fileName: string,
): {
  item: DigestItem;
  merged: boolean;
  mergedTopicPaths: string[];
} {
  const frontMatter = parseStageOneFrontMatter(markdown);
  const { body } = splitFrontMatter(markdown);
  const canonical = extractCanonicalTopicData(body);

  if (!frontMatter) {
    throw new Error(`Unable to parse staged note metadata: ${fileName}`);
  }

  if (!canonical.summary) {
    throw new Error(`Unable to parse staged note summary: ${fileName}`);
  }

  return {
    item: {
      category: frontMatter.category,
      source: frontMatter.source,
      summary: canonical.summary,
      keyPoints: canonical.keyPoints,
      timeline: canonical.timeline,
      references: canonical.references,
    },
    merged: frontMatter.merged,
    mergedTopicPaths: frontMatter.merged_topic_paths,
  };
}

export async function writeStageOneDigestItems(
  options: WriteStageOneDigestItemsOptions,
): Promise<StagedDigestItem[]> {
  const notesDir = path.join(options.projectRoot, "notes");
  const datePrefix = toDateString(options.now ?? new Date());
  const nextByCategory = new Map<DigestCategory, number>();
  const stagedItems: StagedDigestItem[] = [];

  await mkdir(notesDir, { recursive: true });

  for (const item of options.items) {
    const keyPrefix = `${item.category}_${datePrefix}`;
    const currentNext = nextByCategory.get(item.category);
    const index = currentNext ?? (await allocateNextIndex(notesDir, keyPrefix));

    const relativePath = buildStageOneRelativePath(
      item.category,
      datePrefix,
      index,
    );
    const absolutePath = path.join(options.projectRoot, relativePath);
    const markdown = renderStageOneDigestFile(item, false, []);

    await Bun.write(absolutePath, markdown);

    stagedItems.push({
      item,
      absolutePath,
      relativePath,
    });
    nextByCategory.set(item.category, index + 1);
  }

  return stagedItems;
}

export async function listPendingStageOneDigestItems(
  projectRoot: string,
): Promise<StagedDigestItem[]> {
  const notesDir = path.join(projectRoot, "notes");
  let files: string[] = [];

  try {
    files = await readdir(notesDir);
  } catch {
    return [];
  }

  const pending: StagedDigestItem[] = [];

  for (const fileName of files.sort()) {
    if (!fileName.endsWith(".md")) {
      continue;
    }

    const relativePath = path.join("notes", fileName);
    const absolutePath = path.join(projectRoot, relativePath);
    const markdown = await Bun.file(absolutePath).text();
    const staged = parseStageOneDigestItem(markdown, fileName);

    if (staged.merged) {
      continue;
    }

    pending.push({
      item: staged.item,
      absolutePath,
      relativePath,
    });
  }

  return pending;
}

export async function markStageOneDigestItemMerged(
  absolutePath: string,
  mergedTopicPaths: string[],
): Promise<void> {
  const markdown = await Bun.file(absolutePath).text();
  const fileName = path.basename(absolutePath);
  const staged = parseStageOneDigestItem(markdown, fileName);

  if (staged.merged) {
    return;
  }

  await Bun.write(
    absolutePath,
    renderStageOneDigestFile(staged.item, true, [
      ...staged.mergedTopicPaths,
      ...mergedTopicPaths,
    ]),
  );
}
