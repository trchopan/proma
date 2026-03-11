import {
  DIGEST_SOURCES,
  type DigestCategory,
  type DigestItem,
  type DigestSource,
  type TopicRoutingTarget,
} from "../digest/types";
import {
  buildCanonicalBody,
  type CanonicalTopicData,
  extractCanonicalTopicData,
  extractTopicTitle,
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

export const MAX_TOPIC_SLUG_LENGTH = 100;
export const MAX_TOPIC_TAGS = 12;

export function slugifyTopic(input: string): string {
  const normalized = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");

  const truncated = normalized
    .slice(0, MAX_TOPIC_SLUG_LENGTH)
    .replace(/-+$/g, "")
    .replace(/^-+/g, "");

  return truncated.length > 0 ? truncated : "untitled-topic";
}

export function normalizeTags(tags: string[]): string[] {
  const values = tags
    .map((tag) => slugifyTopic(tag))
    .filter((tag) => tag.length > 0);
  return [...new Set(values)].sort();
}

export function governTags(options: {
  existingTags: string[];
  incomingTags: string[];
  aiTags?: string[];
  tagPool: string[];
  maxTags?: number;
}): string[] {
  const maxTags = options.maxTags ?? MAX_TOPIC_TAGS;
  const pool = new Set(normalizeTags(options.tagPool));
  const existing = normalizeTags(options.existingTags);
  const incoming = normalizeTags(options.incomingTags);
  const aiTags = normalizeTags(options.aiTags ?? []);

  const reused = aiTags.filter((tag) => pool.has(tag));
  const newTags = aiTags.filter((tag) => !pool.has(tag));
  const baseline = normalizeTags([...existing, ...incoming]);

  return uniqueOrdered([...reused, ...baseline, ...newTags]).slice(0, maxTags);
}

function normalizeSourcesWithAllowed(
  sources: string[],
  allowedSources: readonly string[],
): DigestSource[] {
  const normalized = sources
    .map((value) => value.trim().toLowerCase())
    .filter((value): value is DigestSource => allowedSources.includes(value));

  return [...new Set(normalized)].sort() as DigestSource[];
}

function computeReferenceKeys(item: DigestItem): string[] {
  return uniqueOrdered(
    item.references.map((reference) =>
      buildReferenceKey(reference.source, reference.link),
    ),
  );
}

function buildReferenceKey(source: DigestSource, link: string): string {
  return `${source}: ${link}`;
}

function toReferenceDigestId(referenceKey: string): string {
  return `refs:${referenceKey}`;
}

function collectExistingMergedDigestIds(mergedDigestIds: string[]): string[] {
  return mergedDigestIds
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

function collectReferenceDigestIds(
  references: CanonicalTopicData["references"],
): string[] {
  return references.map((reference) =>
    toReferenceDigestId(buildReferenceKey(reference.source, reference.link)),
  );
}

function hasDigestIdentity(options: {
  existingMergedDigestIds: string[];
  existingReferenceDigestIds: string[];
  mergedDigestId: string;
  item: DigestItem;
}): { isMerged: boolean } {
  const incomingRefDigestIds = computeReferenceKeys(options.item).map(
    toReferenceDigestId,
  );
  const hasMergedDigestId = options.existingMergedDigestIds.includes(
    options.mergedDigestId,
  );
  const hasAllReferences =
    incomingRefDigestIds.length > 0 &&
    incomingRefDigestIds.every((referenceDigestId) =>
      options.existingReferenceDigestIds.includes(referenceDigestId),
    );

  return { isMerged: hasMergedDigestId || hasAllReferences };
}

function buildTopicContent(options: {
  existingMetadata: Partial<TopicFrontMatter>;
  category: DigestCategory;
  item: DigestItem;
  target: TopicRoutingTarget;
  nowIso: string;
  mergedDigestId: string;
  existingMergedDigestIds: string[];
  updatedAt: string;
  topic: string;
  canonical: CanonicalTopicData;
  allowedSources: readonly string[];
}): string {
  const metadata = buildTopicFrontMatter({
    existingMetadata: options.existingMetadata,
    category: options.category,
    item: options.item,
    target: options.target,
    nowIso: options.nowIso,
    mergedDigestId: options.mergedDigestId,
    existingMergedDigestIds: options.existingMergedDigestIds,
    updatedAt: options.updatedAt,
    allowedSources: options.allowedSources,
  });
  const body = buildCanonicalBody(options.topic, options.canonical);
  return `${serializeFrontMatter(metadata)}${body.trim()}\n`;
}

function buildTopicFrontMatter(options: {
  existingMetadata: Partial<TopicFrontMatter>;
  category: DigestCategory;
  item: DigestItem;
  target: TopicRoutingTarget;
  nowIso: string;
  mergedDigestId: string;
  existingMergedDigestIds: string[];
  updatedAt: string;
  allowedSources: readonly string[];
}): TopicFrontMatter {
  const {
    existingMetadata,
    category,
    item,
    target,
    nowIso,
    mergedDigestId,
    existingMergedDigestIds,
    updatedAt,
    allowedSources,
  } = options;

  const tags = normalizeTags([
    ...(existingMetadata.tags ?? []),
    ...target.tags,
  ]);
  const sources = normalizeSourcesWithAllowed(
    [...(existingMetadata.sources ?? []), item.source],
    allowedSources,
  );
  const mergedDigestIds = uniqueOrdered([
    ...existingMergedDigestIds,
    mergedDigestId,
  ]);

  return {
    category,
    created_at: existingMetadata.created_at ?? nowIso,
    updated_at: updatedAt,
    tags,
    sources,
    digested_note_paths: mergedDigestIds,
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
    mergedReferenceMap.set(
      buildReferenceKey(reference.source, reference.link),
      reference,
    );
  }
  for (const reference of incoming.references) {
    mergedReferenceMap.set(
      buildReferenceKey(reference.source, reference.link),
      {
        source: reference.source,
        link: reference.link,
      },
    );
  }

  const mergedReferences = [...mergedReferenceMap.values()].sort((a, b) => {
    const sourceOrder = a.source.localeCompare(b.source);
    if (sourceOrder !== 0) {
      return sourceOrder;
    }

    return a.link.localeCompare(b.link);
  });

  return {
    summary: existing.summary || incoming.summary,
    keyPoints: mergedKeyPoints,
    timeline: mergedTimeline,
    references: mergedReferences,
  };
}

export function buildTopicMergeContent(options: {
  currentContent: string;
  category: DigestCategory;
  item: DigestItem;
  target: TopicRoutingTarget;
  mergedDigestId: string;
  now?: Date;
  allowedSources?: readonly string[];
}): BuiltTopicMerge {
  const nowIso = (options.now ?? new Date()).toISOString();
  const allowedSources =
    options.allowedSources && options.allowedSources.length > 0
      ? [...options.allowedSources]
      : [...DIGEST_SOURCES];
  const parsed = parseFrontMatter(options.currentContent);
  const topic =
    extractTopicTitle(parsed.body) ||
    options.target.topic.trim() ||
    (options.target.shortDescription?.trim() ?? "Untitled topic");
  const existing = extractCanonicalTopicData(parsed.body, {
    allowedSources,
  });
  const existingMergedDigestIds = collectExistingMergedDigestIds(
    parsed.metadata.digested_note_paths ?? [],
  );
  const existingReferenceDigestIds = collectReferenceDigestIds(
    existing.references,
  );
  const identity = hasDigestIdentity({
    existingMergedDigestIds,
    existingReferenceDigestIds,
    mergedDigestId: options.mergedDigestId,
    item: options.item,
  });

  if (identity.isMerged) {
    return {
      proposedContent: options.currentContent,
      hasChanges: false,
    };
  }

  const mergedCanonical = mergeCanonical(existing, options.item);
  const stableContent = buildTopicContent({
    existingMetadata: parsed.metadata,
    category: options.category,
    item: options.item,
    target: options.target,
    nowIso,
    mergedDigestId: options.mergedDigestId,
    existingMergedDigestIds,
    updatedAt: parsed.metadata.updated_at ?? nowIso,
    allowedSources,
    topic,
    canonical: mergedCanonical,
  });

  if (stableContent === options.currentContent) {
    return {
      proposedContent: options.currentContent,
      hasChanges: false,
    };
  }

  return {
    proposedContent: buildTopicContent({
      existingMetadata: parsed.metadata,
      category: options.category,
      item: options.item,
      target: options.target,
      nowIso,
      mergedDigestId: options.mergedDigestId,
      existingMergedDigestIds,
      updatedAt: nowIso,
      allowedSources,
      topic,
      canonical: mergedCanonical,
    }),
    hasChanges: true,
  };
}
