import type { Logger } from "$/core/logging";
import type { PromptRegistry } from "$/core/prompting/types";

export const DIGEST_CATEGORIES = ["planning", "research", "decision"] as const;

export const DIGEST_SOURCES = ["slack", "wiki", "git", "document"] as const;

export type DigestCategory = (typeof DIGEST_CATEGORIES)[number];
export type DigestSource = string;

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
  digestedCount?: number;
  updatedAt?: string;
  timeboxes?: string[];
  anchors?: string[];
};

export type TopicRoutingTarget = {
  action: "update_existing" | "create_new";
  slug?: string;
  shortDescription?: string;
  topic: string;
  tags: string[];
};

export type MergeContentDecisionInput = {
  category: "decision";
  topic: string;
  tags: string[];
  existing: {
    summary: string;
    decision: string[];
    context: string[];
    optionsConsidered: string[];
    rationaleTradeoffs: string[];
    stakeholders: string[];
    references: DigestReference[];
  };
  incoming: DigestItem;
  tagPool: string[];
};

export type MergeContentResearchInput = {
  category: "research";
  topic: string;
  tags: string[];
  existing: {
    summary: string;
    problemStatement: string[];
    researchPlan: string[];
    keyFindings: string[];
    personInCharge: string[];
    references: DigestReference[];
  };
  incoming: DigestItem;
  tagPool: string[];
};

export type MergeContentPlanningInput = {
  category: "planning";
  topic: string;
  tags: string[];
  existing: {
    summary: string;
    objectivesSuccessCriteria: string[];
    scope: string[];
    deliverables: string[];
    plan: string[];
    timeline: string[];
    teamsIndividualsInvolved: string[];
    references: DigestReference[];
  };
  incoming: DigestItem;
  tagPool: string[];
};

export type MergeContentInput =
  | MergeContentDecisionInput
  | MergeContentResearchInput
  | MergeContentPlanningInput;

export type MergeContentDecisionResult = {
  category: "decision";
  summary: string;
  decision: string[];
  context: string[];
  optionsConsidered: string[];
  rationaleTradeoffs: string[];
  stakeholders: string[];
  references: DigestReference[];
  tags: string[];
};

export type MergeContentResearchResult = {
  category: "research";
  summary: string;
  problemStatement: string[];
  researchPlan: string[];
  keyFindings: string[];
  personInCharge: string[];
  references: DigestReference[];
  tags: string[];
};

export type MergeContentPlanningResult = {
  category: "planning";
  summary: string;
  objectivesSuccessCriteria: string[];
  scope: string[];
  deliverables: string[];
  plan: string[];
  timeline: string[];
  teamsIndividualsInvolved: string[];
  references: DigestReference[];
  tags: string[];
};

export type MergeContentResult =
  | MergeContentDecisionResult
  | MergeContentResearchResult
  | MergeContentPlanningResult;

export type TopicRoutingOptions = PromptDrivenOperationOptions;

export type MergeContentOptions = PromptDrivenOperationOptions;
