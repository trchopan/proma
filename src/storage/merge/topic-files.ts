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
};

const MAX_CANDIDATE_KEY_POINTS = 6;
const MAX_CANDIDATE_TIMELINE = 6;
const MAX_CANDIDATE_REFERENCES = 6;

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

function buildItemTokens(item: DigestItem): string[] {
  return [
    ...tokenize(item.summary),
    ...item.keyPoints.flatMap((point) => tokenize(point)),
    ...item.timeline.flatMap((entry) => tokenize(entry)),
  ];
}

function buildCandidateTokens(candidate: TopicCandidate): string[] {
  return [
    ...tokenize(candidate.topic),
    ...candidate.tags.flatMap((tag) => tokenize(tag)),
    ...tokenize(candidate.summary),
    ...candidate.keyPoints.flatMap((point) => tokenize(point)),
    ...candidate.timeline.flatMap((entry) => tokenize(entry)),
  ];
}

export function rankTopicCandidates(
  item: DigestItem,
  candidates: TopicCandidate[],
  limit = 8,
): TopicCandidate[] {
  const itemTokens = buildItemTokens(item);
  const itemReferenceLinks = new Set(
    item.references.map((reference) => reference.link),
  );

  const ranked = candidates
    .map((candidate) => {
      const candidateTokens = buildCandidateTokens(candidate);
      const tokenOverlap = overlapScore(itemTokens, candidateTokens);
      const tagOverlap = overlapScore(
        item.keyPoints.flatMap((value) => tokenize(value)),
        candidate.tags.flatMap((tag) => tokenize(tag)),
      );
      const referenceOverlap = candidate.references.reduce(
        (score, reference) => {
          return itemReferenceLinks.has(reference.link) ? score + 5 : score;
        },
        0,
      );

      return {
        candidate,
        score: tokenOverlap + tagOverlap * 2 + referenceOverlap,
      };
    })
    .sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }

      return a.candidate.slug.localeCompare(b.candidate.slug);
    });

  return ranked.slice(0, Math.max(1, limit)).map((entry) => entry.candidate);
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
    const summary =
      canonical.summary || firstMeaningfulLine(parsed.body) || topic;

    candidates.push({
      slug,
      topic,
      tags,
      summary,
      keyPoints: canonical.keyPoints.slice(0, MAX_CANDIDATE_KEY_POINTS),
      timeline: canonical.timeline.slice(0, MAX_CANDIDATE_TIMELINE),
      references: canonical.references.slice(0, MAX_CANDIDATE_REFERENCES),
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
