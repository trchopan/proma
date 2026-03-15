import {
  buildTopicBodyByCategory,
  extractTopicDataByCategory,
  extractTopicTitle,
  type TopicDataByCategory,
  uniqueOrdered,
} from "$/core/markdown/canonical-topic";

import {
  parseFrontMatter,
  serializeFrontMatter,
  type TopicFrontMatter,
} from "$/core/markdown/frontmatter";

import {
  DIGEST_SOURCES,
  type DigestCategory,
  type DigestItem,
  type DigestSource,
  type MergeContentResult,
  type TopicRoutingTarget,
} from "$/domain/digest/types";

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

function normalizeIdentityHandle(input: string): string {
  return input
    .trim()
    .replace(/^@+/, "")
    .replace(/[.,;:!?]+$/g, "");
}

function normalizeIdentityPlatform(source: DigestSource): string {
  return source.trim().toLowerCase();
}

function isLikelyIdentityHandle(input: string): boolean {
  const handle = normalizeIdentityHandle(input);
  if (handle.length === 0) {
    return false;
  }

  if (/^U[A-Z0-9]{8,}$/.test(handle)) {
    return true;
  }

  if (/[-_.\d]/.test(handle)) {
    return true;
  }

  return handle === handle.toLowerCase();
}

function parseCanonicalIdentity(
  entry: string,
): { platform: string; handle: string; displayName?: string } | null {
  const fullIdentity = entry.match(
    /^(.+?)\s*\(\s*([a-z0-9._-]+)\s*:\s*([A-Za-z0-9._-]+)\s*\)$/i,
  );
  if (fullIdentity?.[1] && fullIdentity[2] && fullIdentity[3]) {
    const platform = fullIdentity[2].trim().toLowerCase();
    const handle = normalizeIdentityHandle(fullIdentity[3]);
    const displayName = fullIdentity[1].trim();
    if (platform.length === 0 || handle.length === 0) {
      return null;
    }

    return {
      platform,
      handle,
      displayName: displayName.length > 0 ? displayName : undefined,
    };
  }

  const handleOnlyIdentity = entry.match(
    /^\(\s*([a-z0-9._-]+)\s*:\s*([A-Za-z0-9._-]+)\s*\)$/i,
  );
  if (!handleOnlyIdentity?.[1] || !handleOnlyIdentity[2]) {
    return null;
  }

  const platform = handleOnlyIdentity[1].trim().toLowerCase();
  const handle = normalizeIdentityHandle(handleOnlyIdentity[2]);
  if (platform.length === 0 || handle.length === 0) {
    return null;
  }

  return {
    platform,
    handle,
  };
}

function formatIdentity(options: {
  platform: string;
  handle: string;
  displayName?: string;
}): string {
  const handle = normalizeIdentityHandle(options.handle);
  if (handle.length === 0) {
    return "";
  }

  const platform = options.platform.trim().toLowerCase();
  if (platform.length === 0) {
    return "";
  }

  const displayName = options.displayName?.trim();
  if (displayName && displayName.length > 0) {
    return `${displayName} (${platform}:${handle})`;
  }

  return `(${platform}:${handle})`;
}

function normalizeParticipantEntry(
  entry: string,
  fallbackPlatform: string,
): string {
  const trimmed = entry.trim();
  if (trimmed.length === 0 || trimmed.toLowerCase() === "none") {
    return "";
  }

  const canonicalIdentity = parseCanonicalIdentity(trimmed);
  if (canonicalIdentity) {
    return formatIdentity(canonicalIdentity);
  }

  const nameWithHandle = trimmed.match(
    /^(.+?)\s*\(\s*(@?)([A-Za-z0-9._-]+)\s*\)$/,
  );
  if (nameWithHandle?.[1] && nameWithHandle[3]) {
    const hadAtPrefix = nameWithHandle[2] === "@";
    if (!hadAtPrefix && !isLikelyIdentityHandle(nameWithHandle[3])) {
      return trimmed;
    }

    return formatIdentity({
      displayName: nameWithHandle[1],
      platform: fallbackPlatform,
      handle: nameWithHandle[3],
    });
  }

  const handleOnly = trimmed.match(/^(@?)([A-Za-z0-9._-]+)$/);
  if (handleOnly?.[2]) {
    const hadAtPrefix = handleOnly[1] === "@";
    if (!hadAtPrefix && !isLikelyIdentityHandle(handleOnly[2])) {
      return trimmed;
    }

    return formatIdentity({
      platform: fallbackPlatform,
      handle: handleOnly[2],
    });
  }

  return trimmed;
}

function extractPlanningParticipants(item: DigestItem): string[] {
  const platform = normalizeIdentityPlatform(item.source);
  const participantsByIdentity = new Map<string, string>();
  const sources = [item.summary, ...item.keyPoints].filter(
    (value) => value.trim().length > 0,
  );

  const upsertParticipant = (handle: string, displayName?: string) => {
    const normalizedHandle = normalizeIdentityHandle(handle);
    if (normalizedHandle.length === 0) {
      return;
    }

    const normalized = formatIdentity({
      platform,
      handle: normalizedHandle,
      displayName,
    });
    if (normalized.length === 0) {
      return;
    }

    const key = `${platform}:${normalizedHandle.toLowerCase()}`;
    const existing = participantsByIdentity.get(key);
    if (!existing) {
      participantsByIdentity.set(key, normalized);
      return;
    }

    if (existing.startsWith("(") && !normalized.startsWith("(")) {
      participantsByIdentity.set(key, normalized);
    }
  };

  for (const sourceText of sources) {
    const slackUserMentionPattern = /<@([A-Z0-9]+)\|([^>]+)>/g;
    for (const match of sourceText.matchAll(slackUserMentionPattern)) {
      if (match[1]) {
        const displayName = match[2]?.trim();
        upsertParticipant(match[1], displayName);
      }
    }

    const explicitNamePattern =
      /([A-Za-z][A-Za-z0-9.'-]*(?:\s+[A-Za-z][A-Za-z0-9.'-]*){0,5})\s*\(\s*@?([A-Za-z0-9._-]+)\s*\)/g;
    for (const match of sourceText.matchAll(explicitNamePattern)) {
      if (match[1] && match[2]) {
        upsertParticipant(match[2], match[1]);
      }
    }

    const roleHandlePattern =
      /(?:merged by|merged_by|author|assignee|owner|pic)\s*[:-]?\s*(?:([A-Za-z][A-Za-z0-9.'-]*(?:\s+[A-Za-z][A-Za-z0-9.'-]*){0,5})\s*\(\s*@?([A-Za-z0-9][A-Za-z0-9._-]*)\s*\)|@?([A-Za-z0-9][A-Za-z0-9._-]*))/gi;
    for (const match of sourceText.matchAll(roleHandlePattern)) {
      const displayName = match[1]?.trim();
      const handle = (match[2] ?? match[3])?.trim();
      if (!handle) {
        continue;
      }

      const likelyHandle =
        /[-_.\d]/.test(handle) || handle !== handle.toLowerCase();
      if (!likelyHandle && !sourceText.includes(`@${handle}`)) {
        continue;
      }

      upsertParticipant(handle, displayName);
    }

    const mentionPattern = /(^|[^\w])@([A-Za-z0-9._-]+)/g;
    for (const match of sourceText.matchAll(mentionPattern)) {
      if (match[2]) {
        const mentionStart = (match.index ?? 0) + (match[1]?.length ?? 0);
        const mentionEnd = mentionStart + 1 + match[2].length;
        const trailing = sourceText.slice(mentionEnd);
        const likelyNameContinuation =
          /^\s+[A-Z][A-Za-z]/.test(trailing) || /^\s*[/(（]/.test(trailing);
        if (!isLikelyIdentityHandle(match[2]) && likelyNameContinuation) {
          continue;
        }

        upsertParticipant(match[2]);
      }
    }
  }

  return [...participantsByIdentity.values()];
}

function normalizePlanningParticipants(
  values: string[],
  fallbackSource: DigestSource,
): string[] {
  const platform = normalizeIdentityPlatform(fallbackSource);
  const output: string[] = [];
  const rawSet = new Set<string>();
  const indexByIdentity = new Map<string, number>();

  for (const value of values) {
    const normalized = normalizeParticipantEntry(value, platform);
    if (normalized.length === 0) {
      continue;
    }

    const identity = parseCanonicalIdentity(normalized);
    if (!identity) {
      if (!rawSet.has(normalized)) {
        output.push(normalized);
        rawSet.add(normalized);
      }
      continue;
    }

    const key = `${identity.platform}:${identity.handle.toLowerCase()}`;
    const rendered = formatIdentity(identity);
    const existingIndex = indexByIdentity.get(key);
    if (typeof existingIndex === "undefined") {
      output.push(rendered);
      indexByIdentity.set(key, output.length - 1);
      continue;
    }

    const existing = output[existingIndex] ?? "";
    if (existing.startsWith("(") && !rendered.startsWith("(")) {
      output[existingIndex] = rendered;
    }
  }

  return output;
}

function topicDataFromDigestItem(
  category: DigestCategory,
  item: DigestItem,
): TopicDataByCategory {
  if (category === "decision") {
    return {
      summary: item.summary,
      decision: uniqueOrdered(item.keyPoints),
      context: [],
      optionsConsidered: [],
      rationaleTradeoffs: [],
      stakeholders: [],
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
    teamsIndividualsInvolved: extractPlanningParticipants(item),
    references: sortReferences(item.references),
  };
}

function topicDataFromMergeContent(
  content: MergeContentResult,
): TopicDataByCategory {
  if (content.category === "decision") {
    return {
      summary: content.summary,
      decision: content.decision,
      context: content.context,
      optionsConsidered: content.optionsConsidered,
      rationaleTradeoffs: content.rationaleTradeoffs,
      stakeholders: content.stakeholders,
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
  if (category === "decision") {
    const existingDecision = existing as Extract<
      TopicDataByCategory,
      { decision: string[] }
    >;
    const incomingDecision = incoming as Extract<
      TopicDataByCategory,
      { decision: string[] }
    >;
    return {
      summary: existing.summary || incoming.summary,
      decision: uniqueOrdered([
        ...existingDecision.decision,
        ...incomingDecision.decision,
      ]),
      context: uniqueOrdered([
        ...existingDecision.context,
        ...incomingDecision.context,
      ]),
      optionsConsidered: uniqueOrdered([
        ...existingDecision.optionsConsidered,
        ...incomingDecision.optionsConsidered,
      ]),
      rationaleTradeoffs: uniqueOrdered([
        ...existingDecision.rationaleTradeoffs,
        ...incomingDecision.rationaleTradeoffs,
      ]),
      stakeholders: uniqueOrdered([
        ...existingDecision.stakeholders,
        ...incomingDecision.stakeholders,
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
  if (options.category === "planning") {
    const planning = mergedCanonical as Extract<
      TopicDataByCategory,
      { objectivesSuccessCriteria: string[] }
    >;
    const extractedParticipants = extractPlanningParticipants(options.item);
    planning.teamsIndividualsInvolved = normalizePlanningParticipants(
      [...planning.teamsIndividualsInvolved, ...extractedParticipants],
      options.item.source,
    );
  }
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
