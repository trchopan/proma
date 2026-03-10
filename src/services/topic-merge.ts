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
    .map((value) => {
      const source = value.trim().toLowerCase();
      if (source === "figma" || source === "file") {
        return "document";
      }

      return source;
    })
    .filter((value): value is DigestSource =>
      (DIGEST_SOURCES as readonly string[]).includes(value),
    );

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

function toReferenceDigestId(referenceKey: string): string {
  return `refs:${referenceKey}`;
}

function collectExistingDigestIds(options: {
  mergedDigestIds: string[];
  references: CanonicalTopicData["references"];
}): string[] {
  const metadataDigestIds = options.mergedDigestIds
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  const referenceDigestIds = options.references.map((reference) =>
    toReferenceDigestId(buildReferenceKey(reference.source, reference.link)),
  );

  return uniqueOrdered([...metadataDigestIds, ...referenceDigestIds]);
}

function hasDigestIdentity(options: {
  existingDigestIds: string[];
  item: DigestItem;
}): { isMerged: boolean; digestId: string } {
  const digestId = computeDigestIdentity(options.item);
  const incomingRefDigestIds = computeReferenceKeys(options.item).map(
    toReferenceDigestId,
  );
  const hasDigestId = options.existingDigestIds.includes(digestId);
  const hasAllReferences =
    incomingRefDigestIds.length > 0 &&
    incomingRefDigestIds.every((referenceDigestId) =>
      options.existingDigestIds.includes(referenceDigestId),
    );

  return { isMerged: hasDigestId || hasAllReferences, digestId };
}

function buildTopicContent(options: {
  existingMetadata: Partial<TopicFrontMatter>;
  category: DigestCategory;
  item: DigestItem;
  target: TopicRoutingTarget;
  nowIso: string;
  digestId: string;
  existingDigestIds: string[];
  updatedAt: string;
  topic: string;
  canonical: CanonicalTopicData;
}): string {
  const metadata = buildTopicFrontMatter({
    existingMetadata: options.existingMetadata,
    category: options.category,
    item: options.item,
    target: options.target,
    nowIso: options.nowIso,
    digestId: options.digestId,
    existingDigestIds: options.existingDigestIds,
    updatedAt: options.updatedAt,
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
  digestId: string;
  existingDigestIds: string[];
  updatedAt: string;
}): TopicFrontMatter {
  const {
    existingMetadata,
    category,
    item,
    target,
    nowIso,
    digestId,
    existingDigestIds,
    updatedAt,
  } = options;

  const tags = normalizeTags([
    ...(existingMetadata.tags ?? []),
    ...target.tags,
  ]);
  const sources = normalizeSources([
    ...(existingMetadata.sources ?? []),
    item.source,
  ]);
  const mergedDigestIds = uniqueOrdered([...existingDigestIds, digestId]);

  return {
    category,
    created_at: existingMetadata.created_at ?? nowIso,
    updated_at: updatedAt,
    tags,
    sources,
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
  now?: Date;
}): BuiltTopicMerge {
  const nowIso = (options.now ?? new Date()).toISOString();
  const parsed = parseFrontMatter(options.currentContent);
  const topic =
    extractTopicTitle(parsed.body) ||
    options.target.topic.trim() ||
    (options.target.shortDescription?.trim() ?? "Untitled topic");
  const existing = extractCanonicalTopicData(parsed.body);
  const existingDigestIds = collectExistingDigestIds({
    mergedDigestIds: parsed.metadata.merged_digest_ids ?? [],
    references: existing.references,
  });
  const identity = hasDigestIdentity({
    existingDigestIds,
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
    digestId: identity.digestId,
    existingDigestIds,
    updatedAt: parsed.metadata.updated_at ?? nowIso,
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
      digestId: identity.digestId,
      existingDigestIds,
      updatedAt: nowIso,
      topic,
      canonical: mergedCanonical,
    }),
    hasChanges: true,
  };
}
