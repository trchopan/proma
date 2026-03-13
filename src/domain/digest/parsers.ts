import {
  DIGEST_SOURCES,
  type DigestCategory,
  type DigestItem,
  type DigestReference,
  type DigestSource,
  type MergeContentResult,
  type TopicRoutingCandidate,
  type TopicRoutingTarget,
} from "$/domain/digest/types";

const TIMELINE_ENTRY_PATTERN = /^\d{4}-\d{2}-\d{2}\s+-\s+.+$/;

type ParseOptions = {
  category?: DigestCategory;
  allowedSources?: readonly string[];
};

function normalizeAllowedSources(options?: ParseOptions): {
  allowedSourceSet: Set<string>;
  allowedSourcesText: string;
} {
  const allowedSources = [
    ...new Set(
      (options?.allowedSources ?? DIGEST_SOURCES)
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean),
    ),
  ].sort();

  return {
    allowedSourceSet: new Set(allowedSources),
    allowedSourcesText: allowedSources.join(", "),
  };
}

function normalizeCategory(input: unknown): DigestCategory | null {
  if (typeof input !== "string") {
    return null;
  }

  const value = input.trim().toLowerCase();

  if (value === "planning" || value === "research" || value === "discussion") {
    return value;
  }

  return null;
}

function normalizeSource(
  input: unknown,
  allowedSourceSet: Set<string>,
): DigestSource | null {
  if (typeof input !== "string") {
    return null;
  }

  const value = input.trim().toLowerCase();

  if (allowedSourceSet.has(value)) {
    return value;
  }

  return null;
}

function normalizeStringArray(input: unknown): string[] {
  if (!Array.isArray(input)) {
    return [];
  }

  return input
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function normalizeTimeline(input: unknown): string[] {
  if (typeof input === "undefined") {
    return [];
  }

  if (!Array.isArray(input)) {
    throw new Error(
      "Digest item contained invalid timeline (expected array of timeline entries)",
    );
  }

  const timeline = normalizeStringArray(input);

  for (const entry of timeline) {
    if (!TIMELINE_ENTRY_PATTERN.test(entry)) {
      throw new Error(
        "Digest item contained invalid timeline entry (expected format: YYYY-MM-DD - <context>)",
      );
    }
  }

  return [...new Set(timeline)].sort((a, b) => a.localeCompare(b));
}

function normalizeReferences(
  input: unknown,
  options: { allowedSourceSet: Set<string>; allowedSourcesText: string },
): DigestReference[] {
  if (!Array.isArray(input)) {
    return [];
  }

  const references: DigestReference[] = [];

  for (const item of input) {
    if (!item || typeof item !== "object") {
      throw new Error(
        "Digest item contained invalid references (expected objects with source and link)",
      );
    }

    const source = normalizeSource(
      (item as { source?: unknown }).source,
      options.allowedSourceSet,
    );
    const link = (item as { link?: unknown }).link;

    if (!source) {
      throw new Error(
        `Digest item contained invalid reference source (expected one of: ${options.allowedSourcesText})`,
      );
    }

    if (typeof link !== "string" || link.trim().length === 0) {
      throw new Error("Digest item contained empty reference link");
    }

    references.push({
      source,
      link: link.trim(),
    });
  }

  return references;
}

function parseArrayPayload(payload: unknown): unknown[] {
  if (payload && typeof payload === "object") {
    const digestItems = (payload as { items?: unknown }).items;
    if (Array.isArray(digestItems)) {
      return digestItems;
    }
  }

  throw new Error("Digest response must be a JSON object with an items array");
}

export function parseDigestItemsResponse(
  content: string,
  options?: ParseOptions,
): DigestItem[] {
  const normalizedOptions = normalizeAllowedSources(options);
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error("Digest response was not valid JSON");
  }

  const rawItems = parseArrayPayload(parsed);
  const digestItems: DigestItem[] = [];

  for (const item of rawItems) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const category = normalizeCategory(
      (item as { category?: unknown }).category,
    );
    const source = normalizeSource(
      (item as { source?: unknown }).source,
      normalizedOptions.allowedSourceSet,
    );
    const summary = (item as { summary?: unknown }).summary;

    if (!category) {
      throw new Error("Digest item contained invalid category");
    }

    if (!source) {
      throw new Error(
        `Digest item contained invalid source (expected one of: ${normalizedOptions.allowedSourcesText})`,
      );
    }

    if (typeof summary !== "string" || summary.trim().length === 0) {
      throw new Error("Digest item contained empty summary");
    }

    digestItems.push({
      category,
      source,
      summary: summary.trim(),
      keyPoints: normalizeStringArray(
        (item as { keyPoints?: unknown }).keyPoints,
      ),
      timeline: normalizeTimeline((item as { timeline?: unknown }).timeline),
      references: normalizeReferences(
        (item as { references?: unknown }).references,
        normalizedOptions,
      ),
    });
  }

  if (digestItems.length === 0) {
    throw new Error("Digest response did not contain any valid digest items");
  }

  return digestItems;
}

export function parseTopicRoutingResponse(
  content: string,
  candidates: TopicRoutingCandidate[],
): TopicRoutingTarget {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error("Topic routing response was not valid JSON");
  }

  const rawTarget =
    parsed && typeof parsed === "object"
      ? (parsed as { target?: unknown }).target
      : null;

  if (!rawTarget || typeof rawTarget !== "object") {
    throw new Error("Topic routing response must include one target object");
  }

  const validSlugs = new Set(candidates.map((candidate) => candidate.slug));
  const actionValue = (rawTarget as { action?: unknown }).action;
  const topicValue = (rawTarget as { topic?: unknown }).topic;
  const slugValue = (rawTarget as { slug?: unknown }).slug;
  const shortDescriptionValue = (rawTarget as { shortDescription?: unknown })
    .shortDescription;
  const tagsValue = (rawTarget as { tags?: unknown }).tags;

  const action =
    actionValue === "update_existing" || actionValue === "create_new"
      ? actionValue
      : null;

  if (!action) {
    throw new Error("Topic routing target contained invalid action");
  }

  if (typeof topicValue !== "string" || topicValue.trim().length === 0) {
    throw new Error("Topic routing target contained empty topic");
  }

  const tags = normalizeStringArray(tagsValue);

  if (action === "update_existing") {
    if (typeof slugValue !== "string" || slugValue.trim().length === 0) {
      throw new Error(
        "Topic routing target for update_existing must include a slug",
      );
    }

    const slug = slugValue.trim();
    if (!validSlugs.has(slug)) {
      throw new Error(`Topic routing target referenced unknown slug: ${slug}`);
    }

    return {
      action,
      slug,
      topic: topicValue.trim(),
      tags,
    };
  }

  const shortDescription =
    typeof shortDescriptionValue === "string"
      ? shortDescriptionValue.trim()
      : "";

  if (shortDescription.length === 0 && topicValue.trim().length === 0) {
    throw new Error(
      "Topic routing target for create_new must include shortDescription or topic",
    );
  }

  return {
    action,
    shortDescription,
    topic: topicValue.trim(),
    tags,
  };
}

export function parseMergeContentResponse(
  content: string,
  options?: ParseOptions,
): MergeContentResult {
  const normalizedOptions = normalizeAllowedSources(options);
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error("Merge content response was not valid JSON");
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error("Merge content response must be an object");
  }

  const summary = (parsed as { summary?: unknown }).summary;
  const category = normalizeCategory(
    (parsed as { category?: unknown }).category,
  );
  if (typeof summary !== "string" || summary.trim().length === 0) {
    throw new Error("Merge content response contained empty summary");
  }

  const expectedCategory = options?.category;
  if (!category) {
    throw new Error("Merge content response contained invalid category");
  }
  if (expectedCategory && category !== expectedCategory) {
    throw new Error(
      `Merge content response category mismatch (expected ${expectedCategory}, got ${category})`,
    );
  }

  if (category === "discussion") {
    return {
      category,
      summary: summary.trim(),
      contextBackground: normalizeStringArray(
        (parsed as { contextBackground?: unknown }).contextBackground,
      ),
      resolution: normalizeStringArray(
        (parsed as { resolution?: unknown }).resolution,
      ),
      participants: normalizeStringArray(
        (parsed as { participants?: unknown }).participants,
      ),
      references: normalizeReferences(
        (parsed as { references?: unknown }).references,
        normalizedOptions,
      ),
      tags: normalizeStringArray((parsed as { tags?: unknown }).tags),
    };
  }

  if (category === "research") {
    return {
      category,
      summary: summary.trim(),
      problemStatement: normalizeStringArray(
        (parsed as { problemStatement?: unknown }).problemStatement,
      ),
      researchPlan: normalizeStringArray(
        (parsed as { researchPlan?: unknown }).researchPlan,
      ),
      keyFindings: normalizeStringArray(
        (parsed as { keyFindings?: unknown }).keyFindings,
      ),
      personInCharge: normalizeStringArray(
        (parsed as { personInCharge?: unknown }).personInCharge,
      ),
      references: normalizeReferences(
        (parsed as { references?: unknown }).references,
        normalizedOptions,
      ),
      tags: normalizeStringArray((parsed as { tags?: unknown }).tags),
    };
  }

  return {
    category,
    summary: summary.trim(),
    objectivesSuccessCriteria: normalizeStringArray(
      (parsed as { objectivesSuccessCriteria?: unknown })
        .objectivesSuccessCriteria,
    ),
    scope: normalizeStringArray((parsed as { scope?: unknown }).scope),
    deliverables: normalizeStringArray(
      (parsed as { deliverables?: unknown }).deliverables,
    ),
    plan: normalizeStringArray((parsed as { plan?: unknown }).plan),
    timeline: normalizeTimeline((parsed as { timeline?: unknown }).timeline),
    teamsIndividualsInvolved: normalizeStringArray(
      (parsed as { teamsIndividualsInvolved?: unknown })
        .teamsIndividualsInvolved,
    ),
    references: normalizeReferences(
      (parsed as { references?: unknown }).references,
      normalizedOptions,
    ),
    tags: normalizeStringArray((parsed as { tags?: unknown }).tags),
  };
}
