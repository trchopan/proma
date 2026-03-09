import { mkdir, readdir } from "node:fs/promises";
import path from "node:path";

import type { DigestCategory, DigestItem, TopicRoutingTarget } from "../digest";
import {
  extractCanonicalTopicData,
  firstMeaningfulLine,
} from "../markdown/canonical-topic";
import { parseFrontMatter } from "../markdown/frontmatter";
import {
  buildTopicMergeContent,
  normalizeTags,
  slugifyTopic,
} from "../services/topic-merge";

export type TopicCandidate = {
  slug: string;
  topic: string;
  tags: string[];
  summary: string;
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

export { slugifyTopic };

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

  const built = buildTopicMergeContent({
    currentContent,
    category: options.category,
    item: options.item,
    target: options.target,
    now: options.now,
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
