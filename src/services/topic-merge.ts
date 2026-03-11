import {
  DIGEST_SOURCES,
  type DigestCategory,
  type DigestItem,
  type DigestSource,
  type MergeContentResult,
  type TopicRoutingTarget,
} from "../digest/types";
import {
  buildTopicBodyByCategory,
  extractTopicDataByCategory,
  extractTopicTitle,
  type TopicDataByCategory,
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
  references: TopicDataByCategory["references"],
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
  canonical: TopicDataByCategory;
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
  const body = buildTopicBodyByCategory(
    options.topic,
    options.category,
    options.canonical,
  );
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

function sortReferences(
  references: Array<{ source: DigestSource; link: string }>,
): Array<{ source: DigestSource; link: string }> {
  return [...references].sort((a, b) => {
    const sourceOrder = a.source.localeCompare(b.source);
    if (sourceOrder !== 0) {
      return sourceOrder;
    }

    return a.link.localeCompare(b.link);
  });
}

function mergeReferences(
  existing: Array<{ source: DigestSource; link: string }>,
  incoming: Array<{ source: DigestSource; link: string }>,
): Array<{ source: DigestSource; link: string }> {
  const mergedReferenceMap = new Map<
    string,
    { source: DigestSource; link: string }
  >();
  for (const reference of existing) {
    mergedReferenceMap.set(
      buildReferenceKey(reference.source, reference.link),
      reference,
    );
  }
  for (const reference of incoming) {
    mergedReferenceMap.set(
      buildReferenceKey(reference.source, reference.link),
      {
        source: reference.source,
        link: reference.link,
      },
    );
  }

  return sortReferences([...mergedReferenceMap.values()]);
}

function topicDataFromDigestItem(
  category: DigestCategory,
  item: DigestItem,
): TopicDataByCategory {
  if (category === "discussion") {
    return {
      summary: item.summary,
      contextBackground: uniqueOrdered(item.keyPoints),
      resolution: [],
      participants: [],
      references: sortReferences(item.references),
    };
  }

  if (category === "research") {
    return {
      summary: item.summary,
      problemStatement: uniqueOrdered(item.keyPoints),
      researchPlan: [],
      keyFindings: [],
      personInCharge: [],
      references: sortReferences(item.references),
    };
  }

  return {
    summary: item.summary,
    objectivesSuccessCriteria: uniqueOrdered(item.keyPoints),
    scope: [],
    deliverables: [],
    plan: [],
    timeline: [...new Set(item.timeline)].sort((a, b) => a.localeCompare(b)),
    teamsIndividualsInvolved: [],
    references: sortReferences(item.references),
  };
}

function topicDataFromMergeContent(
  content: MergeContentResult,
): TopicDataByCategory {
  if (content.category === "discussion") {
    return {
      summary: content.summary,
      contextBackground: content.contextBackground,
      resolution: content.resolution,
      participants: content.participants,
      references: sortReferences(content.references),
    };
  }

  if (content.category === "research") {
    return {
      summary: content.summary,
      problemStatement: content.problemStatement,
      researchPlan: content.researchPlan,
      keyFindings: content.keyFindings,
      personInCharge: content.personInCharge,
      references: sortReferences(content.references),
    };
  }

  return {
    summary: content.summary,
    objectivesSuccessCriteria: content.objectivesSuccessCriteria,
    scope: content.scope,
    deliverables: content.deliverables,
    plan: content.plan,
    timeline: [...new Set(content.timeline)].sort((a, b) => a.localeCompare(b)),
    teamsIndividualsInvolved: content.teamsIndividualsInvolved,
    references: sortReferences(content.references),
  };
}

function mergeTopicData(
  category: DigestCategory,
  existing: TopicDataByCategory,
  incoming: TopicDataByCategory,
): TopicDataByCategory {
  if (category === "discussion") {
    const existingDiscussion = existing as Extract<
      TopicDataByCategory,
      { contextBackground: string[] }
    >;
    const incomingDiscussion = incoming as Extract<
      TopicDataByCategory,
      { contextBackground: string[] }
    >;
    return {
      summary: existing.summary || incoming.summary,
      contextBackground: uniqueOrdered([
        ...existingDiscussion.contextBackground,
        ...incomingDiscussion.contextBackground,
      ]),
      resolution: uniqueOrdered([
        ...existingDiscussion.resolution,
        ...incomingDiscussion.resolution,
      ]),
      participants: uniqueOrdered([
        ...existingDiscussion.participants,
        ...incomingDiscussion.participants,
      ]),
      references: mergeReferences(existing.references, incoming.references),
    };
  }

  if (category === "research") {
    const existingResearch = existing as Extract<
      TopicDataByCategory,
      { problemStatement: string[] }
    >;
    const incomingResearch = incoming as Extract<
      TopicDataByCategory,
      { problemStatement: string[] }
    >;
    return {
      summary: existing.summary || incoming.summary,
      problemStatement: uniqueOrdered([
        ...existingResearch.problemStatement,
        ...incomingResearch.problemStatement,
      ]),
      researchPlan: uniqueOrdered([
        ...existingResearch.researchPlan,
        ...incomingResearch.researchPlan,
      ]),
      keyFindings: uniqueOrdered([
        ...existingResearch.keyFindings,
        ...incomingResearch.keyFindings,
      ]),
      personInCharge: uniqueOrdered([
        ...existingResearch.personInCharge,
        ...incomingResearch.personInCharge,
      ]),
      references: mergeReferences(existing.references, incoming.references),
    };
  }

  const existingPlanning = existing as Extract<
    TopicDataByCategory,
    { objectivesSuccessCriteria: string[] }
  >;
  const incomingPlanning = incoming as Extract<
    TopicDataByCategory,
    { objectivesSuccessCriteria: string[] }
  >;
  return {
    summary: existing.summary || incoming.summary,
    objectivesSuccessCriteria: uniqueOrdered([
      ...existingPlanning.objectivesSuccessCriteria,
      ...incomingPlanning.objectivesSuccessCriteria,
    ]),
    scope: uniqueOrdered([
      ...existingPlanning.scope,
      ...incomingPlanning.scope,
    ]),
    deliverables: uniqueOrdered([
      ...existingPlanning.deliverables,
      ...incomingPlanning.deliverables,
    ]),
    plan: uniqueOrdered([...existingPlanning.plan, ...incomingPlanning.plan]),
    timeline: [
      ...new Set([...existingPlanning.timeline, ...incomingPlanning.timeline]),
    ].sort((a, b) => a.localeCompare(b)),
    teamsIndividualsInvolved: uniqueOrdered([
      ...existingPlanning.teamsIndividualsInvolved,
      ...incomingPlanning.teamsIndividualsInvolved,
    ]),
    references: mergeReferences(existing.references, incoming.references),
  };
}

export function buildTopicMergeContent(options: {
  currentContent: string;
  category: DigestCategory;
  item: DigestItem;
  target: TopicRoutingTarget;
  mergedDigestId: string;
  mergeContent?: MergeContentResult;
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
  const existing = extractTopicDataByCategory(parsed.body, options.category, {
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

  const incoming =
    options.mergeContent && options.mergeContent.category === options.category
      ? topicDataFromMergeContent(options.mergeContent)
      : topicDataFromDigestItem(options.category, options.item);
  const mergedCanonical = mergeTopicData(options.category, existing, incoming);
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
