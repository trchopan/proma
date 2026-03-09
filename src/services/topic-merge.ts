import { createHash } from "node:crypto";

import {
  DIGEST_SOURCES,
  type DigestCategory,
  type DigestItem,
  type DigestSource,
  type TopicRoutingTarget,
} from "../digest";
import {
  buildCanonicalBody,
  type CanonicalTopicData,
  extractCanonicalTopicData,
  uniqueOrdered,
} from "../markdown/canonical-topic";
import {
  parseFrontMatter,
  serializeFrontMatter,
  type TopicFrontMatter,
} from "../markdown/frontmatter";

export type BuiltTopicMerge = {
  proposedContent: string;
  hasChanges: boolean;
};

export function slugifyTopic(input: string): string {
  const normalized = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");

  return normalized.length > 0 ? normalized : "untitled-topic";
}

export function normalizeTags(tags: string[]): string[] {
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

function mergeCanonical(
  existing: CanonicalTopicData,
  incoming: DigestItem,
): CanonicalTopicData {
  const mergedKeyPoints = uniqueOrdered([
    ...existing.keyPoints,
    ...incoming.keyPoints,
  ]);
  const mergedTimeline = [
    ...new Set([...existing.timeline, ...incoming.timeline]),
  ].sort((a, b) => a.localeCompare(b));

  const mergedReferenceMap = new Map<
    string,
    { source: DigestSource; link: string }
  >();
  for (const reference of existing.references) {
    mergedReferenceMap.set(`${reference.source}: ${reference.link}`, reference);
  }
  for (const reference of incoming.references) {
    mergedReferenceMap.set(`${reference.source}: ${reference.link}`, {
      source: reference.source,
      link: reference.link,
    });
  }

  return {
    summary: existing.summary || incoming.summary,
    keyPoints: mergedKeyPoints,
    timeline: mergedTimeline,
    references: [...mergedReferenceMap.values()],
  };
}

export function buildTopicMergeContent(options: {
  currentContent: string;
  category: DigestCategory;
  item: DigestItem;
  target: TopicRoutingTarget;
  now?: Date;
}): BuiltTopicMerge {
  const nowIso = (options.now ?? new Date()).toISOString();
  const parsed = parseFrontMatter(options.currentContent);
  const existing = extractCanonicalTopicData(parsed.body);
  const incomingRefKeys = computeReferenceKeys(options.item);
  const existingRefKeys = uniqueOrdered([
    ...(parsed.metadata.source_refs ?? []),
    ...existing.references.map(
      (reference) => `${reference.source}: ${reference.link}`,
    ),
  ]);
  const digestId = computeDigestIdentity(options.item);
  const hasDigestId = (parsed.metadata.merged_digest_ids ?? []).includes(
    digestId,
  );
  const hasAllReferences =
    incomingRefKeys.length > 0 &&
    incomingRefKeys.every((referenceKey) =>
      existingRefKeys.includes(referenceKey),
    );

  if (hasDigestId || hasAllReferences) {
    return {
      proposedContent: options.currentContent,
      hasChanges: false,
    };
  }

  const mergedCanonical = mergeCanonical(existing, options.item);
  const body = buildCanonicalBody(mergedCanonical);
  const sourceRefs = uniqueOrdered([...existingRefKeys, ...incomingRefKeys]);

  const stableMetadata = buildTopicFrontMatter({
    existingMetadata: parsed.metadata,
    category: options.category,
    item: options.item,
    target: options.target,
    nowIso,
    digestId,
    sourceRefs,
    updatedAt: parsed.metadata.updated_at ?? nowIso,
  });
  const stableContent = `${serializeFrontMatter(stableMetadata)}${body.trim()}\n`;
  if (stableContent === options.currentContent) {
    return {
      proposedContent: options.currentContent,
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
    sourceRefs,
    updatedAt: nowIso,
  });

  return {
    proposedContent: `${serializeFrontMatter(metadata)}${body.trim()}\n`,
    hasChanges: true,
  };
}
