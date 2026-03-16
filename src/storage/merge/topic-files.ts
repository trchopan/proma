import { mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import {
  extractTopicDataByCategory,
  extractTopicTitle,
  firstMeaningfulLine,
  topicSignalsFromCategoryData,
} from "$/core/markdown/canonical-topic";
import { parseFrontMatter } from "$/core/markdown/frontmatter";
import type {
  DigestCategory,
  DigestItem,
  DigestReference,
  DigestSource,
  MergeContentResult,
  TopicRoutingTarget,
} from "$/domain/digest/types";
import {
  buildTopicMergeContent,
  normalizeTags,
  slugifyTopic,
} from "$/domain/merge/topic-merge";

export type TopicCandidate = {
  slug: string;
  topic: string;
  tags: string[];
  summary: string;
  keyPoints: string[];
  timeline: string[];
  references: DigestReference[];
  digestedCount: number;
  updatedAt: string;
  timeboxes: string[];
  anchors: string[];
};

const MAX_CANDIDATE_KEY_POINTS = 6;
const MAX_CANDIDATE_TIMELINE = 6;
const MAX_CANDIDATE_REFERENCES = 6;

const ROUTING_STOPWORDS = new Set([
  "about",
  "after",
  "aligned",
  "branch",
  "change",
  "closed",
  "create",
  "created",
  "demo",
  "feature",
  "file",
  "files",
  "frontend",
  "from",
  "into",
  "item",
  "line",
  "media",
  "merged",
  "note",
  "notes",
  "portal",
  "pull",
  "release",
  "repo",
  "repository",
  "request",
  "task",
  "team",
  "update",
  "updated",
]);

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);
}

function overlapScore(left: string[], right: string[]): number {
  if (left.length === 0 || right.length === 0) {
    return 0;
  }

  const rightSet = new Set(right);
  let matches = 0;
  for (const token of left) {
    if (rightSet.has(token)) {
      matches += 1;
    }
  }

  return matches;
}

function jaccardSimilarity(left: string[], right: string[]): number {
  if (left.length === 0 || right.length === 0) {
    return 0;
  }

  const leftSet = new Set(left);
  const rightSet = new Set(right);
  let intersection = 0;
  for (const token of leftSet) {
    if (rightSet.has(token)) {
      intersection += 1;
    }
  }

  const union = leftSet.size + rightSet.size - intersection;
  return union > 0 ? intersection / union : 0;
}

function uniqueSorted(values: Iterable<string>): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function isVolatileToken(token: string): boolean {
  return (
    /^\d+$/.test(token) ||
    /^pr\d*$/.test(token) ||
    /^mp\d+$/.test(token) ||
    /^jira\d*$/.test(token)
  );
}

function toReleaseTimebox(version: string): string {
  return `release-${version.replace(/[./]/g, "-")}`;
}

function extractTimeboxes(values: string[]): string[] {
  const result = new Set<string>();

  for (const value of values) {
    for (const match of value.matchAll(/release\/(\d+\.\d+\.\d+)/gi)) {
      if (match[1]) {
        result.add(toReleaseTimebox(match[1]));
      }
    }

    for (const match of value.matchAll(/release[-_](\d+[-.]\d+[-.]\d+)/gi)) {
      if (match[1]) {
        result.add(toReleaseTimebox(match[1]));
      }
    }

    for (const match of value.matchAll(/\bsprint\s*[-_/]?(\d+)\b/gi)) {
      if (match[1]) {
        result.add(`sprint-${match[1]}`);
      }
    }

    for (const match of value.matchAll(/\b(q[1-4])\s*[-_/]?(20\d{2})\b/gi)) {
      if (match[1] && match[2]) {
        result.add(`${match[1].toLowerCase()}-${match[2]}`);
      }
    }
  }

  return uniqueSorted(result);
}

type RoutingSignals = {
  tokens: string[];
  scopeTokens: string[];
  timeboxes: string[];
  anchors: string[];
};

type IdentitySignals = {
  slugTokens: string[];
  topicTokens: string[];
  identityTokens: string[];
  timeboxes: string[];
  anchors: string[];
};

function normalizeAnchor(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function extractAnchors(values: string[]): string[] {
  const anchors = new Set<string>();

  for (const value of values) {
    for (const repo of value.matchAll(
      /\b([a-z0-9][a-z0-9-]{2,})\/([a-z0-9][a-z0-9-]{2,})\b/gi,
    )) {
      const repoName = normalizeAnchor(repo[2] ?? "");
      if (repoName) {
        anchors.add(repoName);
      }
    }

    for (const hostRepo of value.matchAll(
      /git\.[^\s/]+\/[A-Za-z0-9._-]+\/([A-Za-z0-9._-]+)/gi,
    )) {
      const repoName = normalizeAnchor(hostRepo[1] ?? "");
      if (repoName) {
        anchors.add(repoName);
      }
    }

    const normalized = normalizeAnchor(value);
    if (!normalized) {
      continue;
    }

    for (const candidate of normalized.matchAll(
      /\b([a-z0-9]+(?:-[a-z0-9]+)+)\b/g,
    )) {
      const anchor = candidate[1] ?? "";
      if (
        !anchor ||
        anchor.startsWith("release-") ||
        anchor.startsWith("sprint-")
      ) {
        continue;
      }

      if (/^q[1-4]-20\d{2}$/.test(anchor)) {
        continue;
      }

      const parts = anchor.split("-");
      if (parts.length < 2 || parts.length > 5) {
        continue;
      }

      if (/^\d{4}(?:-\d{2}){1,2}$/.test(anchor)) {
        continue;
      }

      if (
        parts.every(
          (part) => ROUTING_STOPWORDS.has(part) || isVolatileToken(part),
        )
      ) {
        continue;
      }

      anchors.add(anchor);
    }
  }

  return uniqueSorted(anchors);
}

function buildScopeTokens(tokens: string[], timeboxes: string[]): string[] {
  const timeboxTokenSet = new Set(
    timeboxes.flatMap((timebox) => tokenize(timebox)),
  );

  return uniqueSorted(
    tokens.filter(
      (token) =>
        !ROUTING_STOPWORDS.has(token) &&
        !isVolatileToken(token) &&
        !timeboxTokenSet.has(token),
    ),
  );
}

function buildItemSignals(item: DigestItem): RoutingSignals {
  const values = [
    item.summary,
    ...item.keyPoints,
    ...item.timeline,
    ...item.references.map((reference) => reference.link),
  ];
  const tokens = values.flatMap((value) => tokenize(value));
  const timeboxes = extractTimeboxes(values);
  const anchors = extractAnchors(values);

  return {
    tokens,
    scopeTokens: buildScopeTokens(tokens, timeboxes),
    timeboxes,
    anchors,
  };
}

function buildTargetIdentitySignals(
  target: TopicRoutingTarget,
  itemSignals: RoutingSignals,
): IdentitySignals {
  const shortDescription = target.shortDescription?.trim() ?? "";
  const targetSlug = slugifyTopic(shortDescription || target.topic);
  const slugTokens = tokenize(targetSlug);
  const topicTokens = [target.topic, shortDescription]
    .filter((value) => value.trim().length > 0)
    .flatMap((value) => tokenize(value));
  const identityTokens = uniqueSorted([...slugTokens, ...topicTokens]);
  const values = [target.topic, shortDescription, ...target.tags];

  return {
    slugTokens,
    topicTokens,
    identityTokens,
    timeboxes: uniqueSorted([
      ...itemSignals.timeboxes,
      ...extractTimeboxes(values),
      ...extractTimeboxes([targetSlug]),
    ]),
    anchors: uniqueSorted([
      ...itemSignals.anchors,
      ...extractAnchors(values),
      ...extractAnchors([targetSlug]),
    ]),
  };
}

function buildCandidateIdentitySignals(
  candidate: TopicCandidate,
): IdentitySignals {
  const slugTokens = tokenize(candidate.slug);
  const topicTokens = tokenize(candidate.topic);
  return {
    slugTokens,
    topicTokens,
    identityTokens: uniqueSorted([...slugTokens, ...topicTokens]),
    timeboxes: candidate.timeboxes,
    anchors: candidate.anchors,
  };
}

function isNearDuplicateIdentity(
  targetIdentity: IdentitySignals,
  candidateIdentity: IdentitySignals,
): boolean {
  const identitySimilarity = jaccardSimilarity(
    targetIdentity.identityTokens,
    candidateIdentity.identityTokens,
  );
  const slugSimilarity = jaccardSimilarity(
    targetIdentity.slugTokens,
    candidateIdentity.slugTokens,
  );
  const topicSimilarity = jaccardSimilarity(
    targetIdentity.topicTokens,
    candidateIdentity.topicTokens,
  );
  const sharedIdentityTokens = overlapScore(
    targetIdentity.identityTokens,
    candidateIdentity.identityTokens,
  );
  const minIdentitySize = Math.min(
    targetIdentity.identityTokens.length,
    candidateIdentity.identityTokens.length,
  );

  const almostSameIdentity =
    minIdentitySize >= 5 &&
    sharedIdentityTokens >= minIdentitySize - 1 &&
    (slugSimilarity >= 0.6 || topicSimilarity >= 0.6);

  return (
    almostSameIdentity ||
    (identitySimilarity >= 0.65 &&
      (slugSimilarity >= 0.5 || topicSimilarity >= 0.5))
  );
}

function buildCandidateSignals(candidate: TopicCandidate): RoutingSignals {
  const values = [
    candidate.topic,
    candidate.summary,
    ...candidate.tags,
    ...candidate.keyPoints,
    ...candidate.timeline,
  ];
  const tokens = values.flatMap((value) => tokenize(value));
  const timeboxes =
    candidate.timeboxes.length > 0
      ? candidate.timeboxes
      : extractTimeboxes(values);

  return {
    tokens,
    scopeTokens: buildScopeTokens(tokens, timeboxes),
    timeboxes,
    anchors: candidate.anchors,
  };
}

function hasHardSplitConflict(scored: CandidateScore): boolean {
  const hasHardTimeboxConflict =
    scored.itemTimeboxes > 0 &&
    (scored.candidateTimeboxes === 0 || scored.sharedTimeboxes === 0);
  const hasHardAnchorConflict =
    scored.itemAnchors > 0 &&
    (scored.candidateAnchors === 0 ||
      scored.sharedAnchors === 0 ||
      scored.sharedAnchors < scored.candidateAnchors);

  return hasHardTimeboxConflict || hasHardAnchorConflict;
}

function isHardSplitAnchor(anchor: string): boolean {
  return (
    anchor.startsWith("project-") ||
    /-(api|web|service|backend|frontend|portal|mobile|app)$/.test(anchor)
  );
}

function hasNearDuplicateHardSplitConflict(options: {
  scored: CandidateScore;
  targetIdentity: IdentitySignals;
  candidateIdentity: IdentitySignals;
}): boolean {
  const hasHardTimeboxConflict =
    options.scored.itemTimeboxes > 0 &&
    (options.scored.candidateTimeboxes === 0 ||
      options.scored.sharedTimeboxes === 0);
  const targetHardAnchors =
    options.targetIdentity.anchors.filter(isHardSplitAnchor);
  const candidateHardAnchors =
    options.candidateIdentity.anchors.filter(isHardSplitAnchor);
  const targetHardAnchorSet = new Set(targetHardAnchors);
  const sharedAnchors = candidateHardAnchors.filter((anchor) =>
    targetHardAnchorSet.has(anchor),
  ).length;
  const hasHardAnchorConflict =
    targetHardAnchors.length > 0 &&
    candidateHardAnchors.length > 0 &&
    sharedAnchors === 0;

  return hasHardTimeboxConflict || hasHardAnchorConflict;
}

function pickDifferentiator(options: {
  itemSignals: RoutingSignals;
  targetIdentity: IdentitySignals;
  candidateIdentity: IdentitySignals;
}): string | null {
  const itemOnlyTimeboxes = options.itemSignals.timeboxes.filter(
    (timebox) => !options.candidateIdentity.timeboxes.includes(timebox),
  );
  if (itemOnlyTimeboxes[0]) {
    return itemOnlyTimeboxes[0];
  }

  const itemOnlyAnchors = options.itemSignals.anchors.filter(
    (anchor) => !options.candidateIdentity.anchors.includes(anchor),
  );
  if (itemOnlyAnchors[0]) {
    return itemOnlyAnchors[0];
  }

  if (options.targetIdentity.timeboxes[0]) {
    return options.targetIdentity.timeboxes[0];
  }

  if (options.targetIdentity.anchors[0]) {
    return options.targetIdentity.anchors[0];
  }

  return null;
}

function withDifferentiatedCreateNewIdentity(options: {
  target: TopicRoutingTarget;
  marker: string | null;
}): TopicRoutingTarget {
  if (options.target.action !== "create_new") {
    return options.target;
  }

  if (!options.marker) {
    return options.target;
  }

  const markerSlug = slugifyTopic(options.marker);
  if (!markerSlug) {
    return options.target;
  }

  const baseShort =
    options.target.shortDescription?.trim() || options.target.topic;
  const baseShortSlug = slugifyTopic(baseShort);
  const nextShort = baseShortSlug.includes(markerSlug)
    ? baseShort
    : `${baseShort} ${options.marker}`;

  const topicSlug = slugifyTopic(options.target.topic);
  const hasTopicMarker = topicSlug.includes(markerSlug);
  const nextTopic = hasTopicMarker
    ? options.target.topic
    : `${options.target.topic} (${options.marker})`;

  return {
    ...options.target,
    shortDescription: nextShort,
    topic: nextTopic,
  };
}

type CandidateScore = {
  candidate: TopicCandidate;
  score: number;
  scopeOverlap: number;
  referenceOverlap: number;
  sharedTimeboxes: number;
  itemTimeboxes: number;
  candidateTimeboxes: number;
  sharedAnchors: number;
  itemAnchors: number;
  candidateAnchors: number;
};

function scoreCandidate(
  item: DigestItem,
  candidate: TopicCandidate,
  itemSignals: RoutingSignals,
): CandidateScore {
  const candidateSignals = buildCandidateSignals(candidate);
  const itemReferenceLinks = new Set(
    item.references.map((reference) => reference.link),
  );
  const tokenOverlap = overlapScore(
    itemSignals.tokens,
    candidateSignals.tokens,
  );
  const scopeOverlap = overlapScore(
    itemSignals.scopeTokens,
    candidateSignals.scopeTokens,
  );
  const tagOverlap = overlapScore(
    itemSignals.scopeTokens,
    candidate.tags.flatMap((tag) => tokenize(tag)),
  );
  const referenceOverlap = candidate.references.reduce((score, reference) => {
    return itemReferenceLinks.has(reference.link) ? score + 5 : score;
  }, 0);

  const itemTimeboxSet = new Set(itemSignals.timeboxes);
  const sharedTimeboxes = candidateSignals.timeboxes.filter((timebox) =>
    itemTimeboxSet.has(timebox),
  ).length;

  let timeboxScore = 0;
  if (
    itemSignals.timeboxes.length > 0 &&
    candidateSignals.timeboxes.length > 0
  ) {
    timeboxScore = sharedTimeboxes > 0 ? sharedTimeboxes * 12 : -20;
  }

  const establishedTopicScore = Math.min(candidate.digestedCount, 6);
  const itemAnchorSet = new Set(itemSignals.anchors);
  const sharedAnchors = candidateSignals.anchors.filter((anchor) =>
    itemAnchorSet.has(anchor),
  ).length;
  const disjointCandidateAnchors = candidateSignals.anchors.filter(
    (anchor) => !itemAnchorSet.has(anchor),
  ).length;

  let anchorScore = 0;
  if (itemSignals.anchors.length > 0 && candidateSignals.anchors.length > 0) {
    anchorScore =
      (sharedAnchors > 0 ? sharedAnchors * 10 : -30) -
      disjointCandidateAnchors * 8;
  }

  return {
    candidate,
    score:
      tokenOverlap +
      scopeOverlap * 3 +
      tagOverlap * 2 +
      referenceOverlap +
      timeboxScore +
      anchorScore +
      establishedTopicScore,
    scopeOverlap,
    referenceOverlap,
    sharedTimeboxes,
    itemTimeboxes: itemSignals.timeboxes.length,
    candidateTimeboxes: candidateSignals.timeboxes.length,
    sharedAnchors,
    itemAnchors: itemSignals.anchors.length,
    candidateAnchors: candidateSignals.anchors.length,
  };
}

function sortScores(left: CandidateScore, right: CandidateScore): number {
  if (right.score !== left.score) {
    return right.score - left.score;
  }

  if (right.sharedTimeboxes !== left.sharedTimeboxes) {
    return right.sharedTimeboxes - left.sharedTimeboxes;
  }

  if (right.sharedAnchors !== left.sharedAnchors) {
    return right.sharedAnchors - left.sharedAnchors;
  }

  if (right.scopeOverlap !== left.scopeOverlap) {
    return right.scopeOverlap - left.scopeOverlap;
  }

  if (right.referenceOverlap !== left.referenceOverlap) {
    return right.referenceOverlap - left.referenceOverlap;
  }

  return left.candidate.slug.localeCompare(right.candidate.slug);
}

export function rankTopicCandidates(
  item: DigestItem,
  candidates: TopicCandidate[],
  limit = 8,
): TopicCandidate[] {
  const itemSignals = buildItemSignals(item);
  const ranked = candidates
    .map((candidate) => scoreCandidate(item, candidate, itemSignals))
    .sort(sortScores);

  return ranked.slice(0, Math.max(1, limit)).map((entry) => entry.candidate);
}

export function chooseConsolidatedTarget(options: {
  item: DigestItem;
  rankedCandidates: TopicCandidate[];
  aiTarget: TopicRoutingTarget;
}): TopicRoutingTarget {
  const itemSignals = buildItemSignals(options.item);

  if (options.aiTarget.action === "update_existing") {
    const selected = options.rankedCandidates.find(
      (candidate) => candidate.slug === options.aiTarget.slug,
    );
    if (!selected) {
      return options.aiTarget;
    }

    const scored = scoreCandidate(options.item, selected, itemSignals);
    if (hasHardSplitConflict(scored)) {
      return {
        action: "create_new",
        shortDescription: options.aiTarget.topic,
        topic: options.aiTarget.topic,
        tags: options.aiTarget.tags,
      };
    }

    return options.aiTarget;
  }

  const topCandidate = options.rankedCandidates[0];
  if (!topCandidate) {
    return options.aiTarget;
  }

  const targetIdentity = buildTargetIdentitySignals(
    options.aiTarget,
    itemSignals,
  );
  const nearDuplicate = options.rankedCandidates
    .map((candidate) => {
      const identity = buildCandidateIdentitySignals(candidate);
      const isNearDuplicate = isNearDuplicateIdentity(targetIdentity, identity);
      if (!isNearDuplicate) {
        return null;
      }

      return {
        candidate,
        identity,
        scored: scoreCandidate(options.item, candidate, itemSignals),
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
    .sort((left, right) => sortScores(left.scored, right.scored))[0];

  if (nearDuplicate) {
    const hasHardConflict = hasNearDuplicateHardSplitConflict({
      scored: nearDuplicate.scored,
      targetIdentity,
      candidateIdentity: nearDuplicate.identity,
    });

    if (!hasHardConflict) {
      return {
        action: "update_existing",
        slug: nearDuplicate.candidate.slug,
        topic: nearDuplicate.candidate.topic,
        tags: options.aiTarget.tags,
      };
    }

    const differentiator = pickDifferentiator({
      itemSignals,
      targetIdentity,
      candidateIdentity: nearDuplicate.identity,
    });
    return withDifferentiatedCreateNewIdentity({
      target: options.aiTarget,
      marker: differentiator,
    });
  }

  const scored = scoreCandidate(options.item, topCandidate, itemSignals);
  if (hasHardSplitConflict(scored)) {
    return options.aiTarget;
  }

  const confidentMatch =
    scored.score >= 18 &&
    scored.scopeOverlap >= 1 &&
    (scored.sharedTimeboxes > 0 || scored.itemTimeboxes === 0) &&
    (scored.sharedAnchors > 0 ||
      scored.itemAnchors === 0 ||
      scored.referenceOverlap >= 5);
  if (!confidentMatch) {
    return options.aiTarget;
  }

  return {
    action: "update_existing",
    slug: topCandidate.slug,
    topic: topCandidate.topic,
    tags: options.aiTarget.tags,
  };
}

export function collectCategoryTagPool(candidates: TopicCandidate[]): string[] {
  return normalizeTags(candidates.flatMap((candidate) => candidate.tags));
}

export type PrepareTopicMergeOptions = {
  projectRoot: string;
  category: DigestCategory;
  item: DigestItem;
  mergeContent?: MergeContentResult;
  target: TopicRoutingTarget;
  mergedDigestId: string;
  now?: Date;
  allowedSources?: readonly DigestSource[];
};

export type PreparedTopicMerge = {
  targetPath: string;
  relativeTargetPath: string;
  currentContent: string;
  proposedContent: string;
  isNew: boolean;
  hasChanges: boolean;
};

export { slugifyTopic };

export async function listTopicCandidates(
  projectRoot: string,
  category: DigestCategory,
  allowedSources?: readonly DigestSource[],
): Promise<TopicCandidate[]> {
  const activeSources =
    allowedSources && allowedSources.length > 0
      ? [...allowedSources]
      : undefined;
  const categoryDir = path.join(projectRoot, "topics", category);
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
    const fileCategory = category;
    const topicData = extractTopicDataByCategory(parsed.body, fileCategory, {
      allowedSources: activeSources,
    });
    const canonical = topicSignalsFromCategoryData(fileCategory, topicData);
    const slug = fileName.slice(0, -3);
    const topic = extractTopicTitle(parsed.body) || slug;
    const tags = normalizeTags(parsed.metadata.tags ?? []);
    const digestedCount = parsed.metadata.digested_note_paths?.length ?? 0;
    const updatedAt = parsed.metadata.updated_at ?? "";
    const summary =
      canonical.summary || firstMeaningfulLine(parsed.body) || topic;
    const timeboxes = extractTimeboxes([
      topic,
      summary,
      ...tags,
      ...canonical.keyPoints,
      ...canonical.timeline,
      ...canonical.references.map((reference) => reference.link),
    ]);
    const anchors = extractAnchors([
      topic,
      summary,
      ...tags,
      ...canonical.keyPoints,
      ...canonical.timeline,
      ...canonical.references.map((reference) => reference.link),
    ]);

    candidates.push({
      slug,
      topic,
      tags,
      summary,
      keyPoints: canonical.keyPoints.slice(0, MAX_CANDIDATE_KEY_POINTS),
      timeline: canonical.timeline.slice(0, MAX_CANDIDATE_TIMELINE),
      references: canonical.references.slice(0, MAX_CANDIDATE_REFERENCES),
      digestedCount,
      updatedAt,
      timeboxes,
      anchors,
    });
  }

  return candidates.sort((a, b) => a.slug.localeCompare(b.slug));
}

export async function prepareTopicMerge(
  options: PrepareTopicMergeOptions,
): Promise<PreparedTopicMerge> {
  const slug =
    options.target.action === "update_existing"
      ? (options.target.slug ?? "")
      : slugifyTopic(
          options.target.shortDescription?.trim() || options.target.topic,
        );

  if (!slug) {
    throw new Error("Topic merge target slug could not be resolved");
  }

  const relativeTargetPath = path.join(
    "topics",
    options.category,
    `${slug}.md`,
  );
  const targetPath = path.join(options.projectRoot, relativeTargetPath);

  let currentContent = "";
  try {
    currentContent = await Bun.file(targetPath).text();
  } catch {
    currentContent = "";
  }

  const built = buildTopicMergeContent({
    currentContent,
    category: options.category,
    item: options.item,
    mergeContent: options.mergeContent,
    target: options.target,
    mergedDigestId: options.mergedDigestId,
    now: options.now,
    allowedSources: options.allowedSources,
  });

  return {
    targetPath,
    relativeTargetPath,
    currentContent,
    proposedContent: built.proposedContent,
    isNew: currentContent.trim().length === 0,
    hasChanges: built.hasChanges,
  };
}

export async function writePreparedTopicMerge(
  plan: PreparedTopicMerge,
): Promise<void> {
  await mkdir(path.dirname(plan.targetPath), { recursive: true });
  await Bun.write(plan.targetPath, plan.proposedContent);
}
