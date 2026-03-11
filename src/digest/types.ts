import type { Logger } from "../logging";
import type { PromptRegistry } from "../prompting/types";

export const DIGEST_CATEGORIES = [
  "planning",
  "research",
  "discussion",
] as const;

export const DIGEST_SOURCES = ["slack", "wiki", "git", "document"] as const;

export type DigestCategory = (typeof DIGEST_CATEGORIES)[number];
export type DigestSource = (typeof DIGEST_SOURCES)[number];

export type DigestReference = {
  source: DigestSource;
  link: string;
};

export type DigestItem = {
  category: DigestCategory;
  source: DigestSource;
  summary: string;
  keyPoints: string[];
  timeline: string[];
  references: DigestReference[];
};

export type PromptDrivenOperationOptions = {
  model: string;
  logger?: Logger;
  promptRegistry: PromptRegistry;
  dryRun?: boolean;
};

export type DigestGenerationOptions = PromptDrivenOperationOptions;

export type DigestInputImage = {
  url: string;
  label: string;
};

export type DigestGenerationInput =
  | string
  | {
      text: string;
      images?: DigestInputImage[];
    };

export type TopicRoutingCandidate = {
  slug: string;
  topic: string;
  tags: string[];
  summary: string;
  keyPoints: string[];
  timeline: string[];
  references: DigestReference[];
};

export type TopicRoutingTarget = {
  action: "update_existing" | "create_new";
  slug?: string;
  shortDescription?: string;
  topic: string;
  tags: string[];
};

export type MergeContentInput = {
  category: DigestCategory;
  topic: string;
  tags: string[];
  existing: {
    summary: string;
    keyPoints: string[];
    timeline: string[];
    references: DigestReference[];
  };
  incoming: DigestItem;
  tagPool: string[];
};

export type MergeContentResult = {
  summary: string;
  keyPoints: string[];
  timeline: string[];
  references: DigestReference[];
  tags: string[];
};

export type TopicRoutingOptions = PromptDrivenOperationOptions;

export type MergeContentOptions = PromptDrivenOperationOptions;
