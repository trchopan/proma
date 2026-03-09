import { createHash } from "node:crypto";
import { mkdir, readdir } from "node:fs/promises";
import path from "node:path";

import {
  DIGEST_CATEGORIES,
  DIGEST_SOURCES,
  type DigestCategory,
  type DigestItem,
  type DigestSource,
  renderDigestMarkdown,
  type TopicRoutingTarget,
} from "./digest";

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
};

export type TopicCandidate = {
  slug: string;
  topic: string;
  tags: string[];
  summary: string;
};

type TopicFrontMatter = {
  topic: string;
  category: DigestCategory;
  created_at: string;
  updated_at: string;
  tags: string[];
  sources: DigestSource[];
  source_refs: string[];
  merged_digest_ids: string[];
};

export type PrepareTopicMergeOptions = {
  projectRoot: string;
  category: DigestCategory;
  item: DigestItem;
  target: TopicRoutingTarget;
  now?: Date;
};

export type PreparedTopicMerge = {
  targetPath: string;
  relativeTargetPath: string;
  currentContent: string;
  proposedContent: string;
  isNew: boolean;
  hasChanges: boolean;
};

type ParsedFrontMatter = {
  metadata: Partial<TopicFrontMatter>;
  body: string;
};

type CanonicalTopicData = {
  summary: string;
  keyPoints: string[];
  timeline: string[];
  references: Array<{ source: DigestSource; link: string }>;
};

const TIMELINE_ENTRY_PATTERN = /^\d{4}-\d{2}-\d{2}\s+-\s+.+$/;

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
  return (DIGEST_SOURCES as readonly string[]).includes(value)
    ? (value as DigestSource)
    : null;
}

function inferCategoryFromStageFileName(
  fileName: string,
): DigestCategory | null {
  const match = fileName.match(/^([a-z]+)_\d{4}-\d{2}-\d{2}_\d+\.md$/);
  if (!match?.[1]) {
    return null;
  }

  return parseDigestCategory(match[1]);
}

function parseScalarFrontMatterEntries(
  frontMatter: string,
): Map<string, string> {
  const values = new Map<string, string>();
  const lines = frontMatter.split("\n");

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const match = line.match(/^([a-z_]+):\s*(.*)$/);
    if (!match?.[1]) {
      continue;
    }

    const key = match[1];
    const value = (match[2] ?? "").trim().replace(/^['"]|['"]$/g, "");
    values.set(key, value);
  }

  return values;
}

function parseStageOneFrontMatter(
  markdown: string,
  fileName: string,
): StageOneFrontMatter | null {
  const { frontMatter, body } = splitFrontMatter(markdown);
  const entries = parseScalarFrontMatterEntries(frontMatter);
  const canonical = extractCanonicalTopicData(body);

  const frontMatterCategory = entries.get("category");
  const category = frontMatterCategory
    ? parseDigestCategory(frontMatterCategory)
    : inferCategoryFromStageFileName(fileName);

  if (!category) {
    return null;
  }

  const frontMatterSource = entries.get("source");
  const source = frontMatterSource
    ? parseDigestSource(frontMatterSource)
    : (canonical.references[0]?.source ?? "wiki");

  if (!source) {
    return null;
  }

  const mergedRaw = entries.get("merged");
  const merged = mergedRaw ? mergedRaw.toLowerCase() === "true" : false;

  return {
    category,
    source,
    merged,
  };
}

function renderStageOneFrontMatter(metadata: StageOneFrontMatter): string {
  return [
    "---",
    `category: ${metadata.category}`,
    `source: ${metadata.source}`,
    `merged: ${metadata.merged ? "true" : "false"}`,
    "---",
    "",
  ].join("\n");
}

function renderStageOneDigestFile(item: DigestItem, merged: boolean): string {
  return `${renderStageOneFrontMatter({
    category: item.category,
    source: item.source,
    merged,
  })}${renderDigestMarkdown(item)}`;
}

function parseStageOneDigestItem(
  markdown: string,
  fileName: string,
): { item: DigestItem; merged: boolean } {
  const frontMatter = parseStageOneFrontMatter(markdown, fileName);
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
  };
}

export async function writeStageOneDigestItems(
  options: WriteStageOneDigestItemsOptions,
): Promise<StagedDigestItem[]> {
  const projectRoot = options.projectRoot;
  const notesDir = path.join(projectRoot, "notes");
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
    const absolutePath = path.join(projectRoot, relativePath);
    const markdown = renderStageOneDigestFile(item, false);

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
): Promise<void> {
  const markdown = await Bun.file(absolutePath).text();
  const fileName = path.basename(absolutePath);
  const staged = parseStageOneDigestItem(markdown, fileName);

  if (staged.merged) {
    return;
  }

  await Bun.write(absolutePath, renderStageOneDigestFile(staged.item, true));
}

export function slugifyTopic(input: string): string {
  const normalized = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");

  return normalized.length > 0 ? normalized : "untitled-topic";
}

function uniqueOrdered(values: string[]): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];

  for (const value of values) {
    const normalized = value.trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    ordered.push(normalized);
  }

  return ordered;
}

function normalizeTags(tags: string[]): string[] {
  const values = tags
    .map((tag) => slugifyTopic(tag))
    .filter((tag) => tag.length > 0);

  return [...new Set(values)].sort();
}

function normalizeSources(sources: string[]): DigestSource[] {
  const normalized = sources
    .map((value) => value.trim().toLowerCase())
    .filter((value): value is DigestSource =>
      (DIGEST_SOURCES as readonly string[]).includes(value),
    );

  return [...new Set(normalized)].sort() as DigestSource[];
}

function splitFrontMatter(markdown: string): {
  frontMatter: string;
  body: string;
} {
  if (!markdown.startsWith("---\n")) {
    return { frontMatter: "", body: markdown };
  }

  const end = markdown.indexOf("\n---\n", 4);
  if (end === -1) {
    return { frontMatter: "", body: markdown };
  }

  const frontMatter = markdown.slice(4, end);
  const body = markdown.slice(end + 5);

  return { frontMatter, body };
}

function parseStringArray(raw: string): string[] {
  if (!raw.startsWith("[") || !raw.endsWith("]")) {
    return [];
  }

  const inner = raw.slice(1, -1).trim();
  if (!inner) {
    return [];
  }

  return inner
    .split(",")
    .map((value) => value.trim())
    .map((value) => value.replace(/^['"]|['"]$/g, ""))
    .filter((value) => value.length > 0);
}

function parseFrontMatter(markdown: string): ParsedFrontMatter {
  const { frontMatter, body } = splitFrontMatter(markdown);
  if (!frontMatter) {
    return { metadata: {}, body };
  }

  const metadata: Partial<TopicFrontMatter> = {};
  const lines = frontMatter.split("\n");
  const arrayKeys = new Set([
    "tags",
    "sources",
    "source_refs",
    "merged_digest_ids",
  ]);

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]?.trim() ?? "";
    if (!line || line.startsWith("#")) {
      continue;
    }

    const match = line.match(/^([a-z_]+):\s*(.*)$/);
    if (!match) {
      continue;
    }

    const key = match[1] ?? "";
    const value = (match[2] ?? "").trim();

    if (arrayKeys.has(key)) {
      if (value) {
        const parsedInline = parseStringArray(value);
        if (key === "tags") metadata.tags = parsedInline;
        if (key === "sources")
          metadata.sources = parsedInline as DigestSource[];
        if (key === "source_refs") metadata.source_refs = parsedInline;
        if (key === "merged_digest_ids")
          metadata.merged_digest_ids = parsedInline;
        continue;
      }

      const values: string[] = [];
      for (let j = i + 1; j < lines.length; j += 1) {
        const itemLine = lines[j] ?? "";
        const itemMatch = itemLine.match(/^\s*-\s+(.+)$/);
        if (!itemMatch?.[1]) {
          break;
        }
        values.push(itemMatch[1].trim().replace(/^['"]|['"]$/g, ""));
        i = j;
      }

      if (key === "tags") metadata.tags = values;
      if (key === "sources") metadata.sources = values as DigestSource[];
      if (key === "source_refs") metadata.source_refs = values;
      if (key === "merged_digest_ids") metadata.merged_digest_ids = values;
      continue;
    }

    const scalar = value.replace(/^['"]|['"]$/g, "");
    if (key === "topic") metadata.topic = scalar;
    if (key === "category") metadata.category = scalar as DigestCategory;
    if (key === "created_at") metadata.created_at = scalar;
    if (key === "updated_at") metadata.updated_at = scalar;
  }

  return { metadata, body };
}

function yamlQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function serializeFrontMatter(metadata: TopicFrontMatter): string {
  return [
    "---",
    `topic: ${yamlQuote(metadata.topic)}`,
    `category: ${metadata.category}`,
    `created_at: ${yamlQuote(metadata.created_at)}`,
    `updated_at: ${yamlQuote(metadata.updated_at)}`,
    "tags:",
    ...metadata.tags.map((tag) => `  - ${yamlQuote(tag)}`),
    "sources:",
    ...metadata.sources.map((source) => `  - ${source}`),
    "source_refs:",
    ...metadata.source_refs.map((ref) => `  - ${yamlQuote(ref)}`),
    "merged_digest_ids:",
    ...metadata.merged_digest_ids.map((id) => `  - ${yamlQuote(id)}`),
    "---",
    "",
  ].join("\n");
}

function parseReferenceKey(
  value: string,
): { source: DigestSource; link: string } | null {
  const match = value.match(/^([a-z]+):\s*(.+)$/i);
  if (!match?.[1] || !match[2]) {
    return null;
  }

  const source = match[1].trim().toLowerCase();
  const link = match[2].trim();
  if (!(DIGEST_SOURCES as readonly string[]).includes(source) || !link) {
    return null;
  }

  return { source: source as DigestSource, link };
}

function parseTimelineEntry(value: string): string | null {
  const normalized = value.trim();
  if (!normalized || !TIMELINE_ENTRY_PATTERN.test(normalized)) {
    return null;
  }

  return normalized;
}

function extractCanonicalTopicData(body: string): CanonicalTopicData {
  const lines = body.split("\n");
  let section: "summary" | "keyPoints" | "timeline" | "references" | null =
    null;
  let summary = "";
  const keyPoints: string[] = [];
  const timeline: string[] = [];
  const references: Array<{ source: DigestSource; link: string }> = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (/^##\s+Summary\s*$/i.test(line)) {
      section = "summary";
      continue;
    }
    if (/^##\s+Key Points\s*$/i.test(line)) {
      section = "keyPoints";
      continue;
    }
    if (/^##\s+Timeline\s*$/i.test(line)) {
      section = "timeline";
      continue;
    }
    if (/^##\s+References\s*$/i.test(line)) {
      section = "references";
      continue;
    }

    if (section === "summary" && line.length > 0 && !line.startsWith("#")) {
      if (!summary) {
        summary = line;
      }
      continue;
    }

    if (section === "keyPoints") {
      const bullet = line.match(/^-\s+(.+)$/);
      if (bullet?.[1] && bullet[1] !== "None") {
        keyPoints.push(bullet[1].trim());
      }
      continue;
    }

    if (section === "timeline") {
      const bullet = line.match(/^-\s+(.+)$/);
      if (!bullet?.[1] || bullet[1] === "None") {
        continue;
      }
      const parsed = parseTimelineEntry(bullet[1]);
      if (parsed) {
        timeline.push(parsed);
      }
      continue;
    }

    if (section === "references") {
      const bullet = line.match(/^-\s+(.+)$/);
      if (!bullet?.[1] || bullet[1] === "None") {
        continue;
      }
      const parsed = parseReferenceKey(bullet[1]);
      if (parsed) {
        references.push(parsed);
      }
    }
  }

  const uniqueRefs = uniqueOrdered(
    references.map((reference) => `${reference.source}: ${reference.link}`),
  )
    .map(parseReferenceKey)
    .filter((value): value is { source: DigestSource; link: string } =>
      Boolean(value),
    );

  return {
    summary,
    keyPoints: uniqueOrdered(keyPoints),
    timeline: [...new Set(timeline)].sort((a, b) => a.localeCompare(b)),
    references: uniqueRefs,
  };
}

function buildCanonicalBody(data: CanonicalTopicData): string {
  const summary = data.summary || "No summary yet.";
  const keyPoints =
    data.keyPoints.length > 0
      ? data.keyPoints.map((value) => `- ${value}`).join("\n")
      : "- None";
  const timeline =
    data.timeline.length > 0
      ? data.timeline.map((value) => `- ${value}`).join("\n")
      : "- None";
  const references =
    data.references.length > 0
      ? data.references
          .map((value) => `- ${value.source}: ${value.link}`)
          .join("\n")
      : "- None";

  return [
    "## Summary",
    summary,
    "",
    "## Key Points",
    keyPoints,
    "",
    "## Timeline",
    timeline,
    "",
    "## References",
    references,
    "",
  ].join("\n");
}

function computeReferenceKeys(item: DigestItem): string[] {
  return uniqueOrdered(
    item.references.map(
      (reference) => `${reference.source}: ${reference.link}`,
    ),
  );
}

function computeDigestIdentity(item: DigestItem): string {
  const refs = computeReferenceKeys(item).sort();
  if (refs.length > 0) {
    return `refs:${refs.join("|")}`;
  }

  const hashInput = JSON.stringify({
    source: item.source,
    summary: item.summary,
    keyPoints: item.keyPoints,
    timeline: item.timeline,
  });

  return `hash:${createHash("sha1").update(hashInput).digest("hex")}`;
}

function buildTopicFrontMatter(options: {
  existingMetadata: Partial<TopicFrontMatter>;
  category: DigestCategory;
  item: DigestItem;
  target: TopicRoutingTarget;
  nowIso: string;
  digestId: string;
  sourceRefs: string[];
  updatedAt: string;
}): TopicFrontMatter {
  const {
    existingMetadata,
    category,
    item,
    target,
    nowIso,
    digestId,
    sourceRefs,
    updatedAt,
  } = options;

  const topic =
    existingMetadata.topic?.trim() ||
    target.topic.trim() ||
    (target.shortDescription?.trim() ?? "Untitled topic");

  const tags = normalizeTags([
    ...(existingMetadata.tags ?? []),
    ...target.tags,
  ]);
  const sources = normalizeSources([
    ...(existingMetadata.sources ?? []),
    item.source,
  ]);
  const mergedDigestIds = uniqueOrdered([
    ...(existingMetadata.merged_digest_ids ?? []),
    digestId,
  ]);

  return {
    topic,
    category,
    created_at: existingMetadata.created_at ?? nowIso,
    updated_at: updatedAt,
    tags,
    sources,
    source_refs: uniqueOrdered([
      ...(existingMetadata.source_refs ?? []),
      ...sourceRefs,
    ]),
    merged_digest_ids: mergedDigestIds,
  };
}

function firstMeaningfulLine(markdown: string): string {
  const lines = markdown
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));

  return lines[0] ?? "";
}

export async function listTopicCandidates(
  projectRoot: string,
  category: DigestCategory,
): Promise<TopicCandidate[]> {
  const categoryDir = path.join(projectRoot, category);
  let files: string[] = [];

  try {
    files = await readdir(categoryDir);
  } catch {
    return [];
  }

  const candidates: TopicCandidate[] = [];
  for (const fileName of files) {
    if (!fileName.endsWith(".md")) {
      continue;
    }

    const absolutePath = path.join(categoryDir, fileName);
    const markdown = await Bun.file(absolutePath).text();
    const parsed = parseFrontMatter(markdown);
    const canonical = extractCanonicalTopicData(parsed.body);
    const slug = fileName.slice(0, -3);
    const topic = parsed.metadata.topic?.trim() || slug;
    const tags = normalizeTags(parsed.metadata.tags ?? []);
    const summary =
      canonical.summary || firstMeaningfulLine(parsed.body) || topic;

    candidates.push({
      slug,
      topic,
      tags,
      summary,
    });
  }

  return candidates.sort((a, b) => a.slug.localeCompare(b.slug));
}

export async function prepareTopicMerge(
  options: PrepareTopicMergeOptions,
): Promise<PreparedTopicMerge> {
  const nowIso = (options.now ?? new Date()).toISOString();
  const slug =
    options.target.action === "update_existing"
      ? (options.target.slug ?? "")
      : slugifyTopic(
          options.target.shortDescription?.trim() || options.target.topic,
        );

  if (!slug) {
    throw new Error("Topic merge target slug could not be resolved");
  }

  const relativeTargetPath = path.join(options.category, `${slug}.md`);
  const targetPath = path.join(options.projectRoot, relativeTargetPath);

  let currentContent = "";
  try {
    currentContent = await Bun.file(targetPath).text();
  } catch {
    currentContent = "";
  }

  const parsed = parseFrontMatter(currentContent);
  const existing = extractCanonicalTopicData(parsed.body);
  const incomingRefKeys = computeReferenceKeys(options.item);
  const existingRefKeys = uniqueOrdered([
    ...(parsed.metadata.source_refs ?? []),
    ...existing.references.map(
      (reference) => `${reference.source}: ${reference.link}`,
    ),
  ]);
  const digestId = computeDigestIdentity(options.item);
  const isLegacyAppendFormat = parsed.body.includes("## Digest Entries");
  const hasDigestId = (parsed.metadata.merged_digest_ids ?? []).includes(
    digestId,
  );
  const hasAllReferences =
    incomingRefKeys.length > 0 &&
    incomingRefKeys.every((referenceKey) =>
      existingRefKeys.includes(referenceKey),
    );

  if (!isLegacyAppendFormat && (hasDigestId || hasAllReferences)) {
    return {
      targetPath,
      relativeTargetPath,
      currentContent,
      proposedContent: currentContent,
      isNew: currentContent.trim().length === 0,
      hasChanges: false,
    };
  }

  const mergedKeyPoints = uniqueOrdered([
    ...existing.keyPoints,
    ...options.item.keyPoints,
  ]);
  const mergedTimeline = [
    ...new Set([...existing.timeline, ...options.item.timeline]),
  ].sort((a, b) => a.localeCompare(b));

  const mergedReferenceMap = new Map<
    string,
    { source: DigestSource; link: string }
  >();
  for (const reference of existing.references) {
    mergedReferenceMap.set(`${reference.source}: ${reference.link}`, reference);
  }
  for (const reference of options.item.references) {
    mergedReferenceMap.set(`${reference.source}: ${reference.link}`, {
      source: reference.source,
      link: reference.link,
    });
  }

  const mergedCanonical: CanonicalTopicData = {
    summary: existing.summary || options.item.summary,
    keyPoints: mergedKeyPoints,
    timeline: mergedTimeline,
    references: [...mergedReferenceMap.values()],
  };

  const body = buildCanonicalBody(mergedCanonical);
  const stableMetadata = buildTopicFrontMatter({
    existingMetadata: parsed.metadata,
    category: options.category,
    item: options.item,
    target: options.target,
    nowIso,
    digestId,
    sourceRefs: uniqueOrdered([...existingRefKeys, ...incomingRefKeys]),
    updatedAt: parsed.metadata.updated_at ?? nowIso,
  });
  const stableContent = `${serializeFrontMatter(stableMetadata)}${body.trim()}\n`;

  if (stableContent === currentContent) {
    return {
      targetPath,
      relativeTargetPath,
      currentContent,
      proposedContent: currentContent,
      isNew: currentContent.trim().length === 0,
      hasChanges: false,
    };
  }

  const metadata = buildTopicFrontMatter({
    existingMetadata: parsed.metadata,
    category: options.category,
    item: options.item,
    target: options.target,
    nowIso,
    digestId,
    sourceRefs: uniqueOrdered([...existingRefKeys, ...incomingRefKeys]),
    updatedAt: nowIso,
  });

  const proposedContent = `${serializeFrontMatter(metadata)}${body.trim()}\n`;

  return {
    targetPath,
    relativeTargetPath,
    currentContent,
    proposedContent,
    isNew: currentContent.trim().length === 0,
    hasChanges: true,
  };
}

export async function writePreparedTopicMerge(
  plan: PreparedTopicMerge,
): Promise<void> {
  await mkdir(path.dirname(plan.targetPath), { recursive: true });
  await Bun.write(plan.targetPath, plan.proposedContent);
}
