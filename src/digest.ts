import type { ChatCompletionOptions } from "./ai/openai";
import type { Logger } from "./logging";
import { executePromptOperation } from "./prompting/execute";
import type { PromptRegistry } from "./prompting/types";

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

export type DigestGenerationOptions = {
  model: string;
  logger?: Logger;
  promptRegistry: PromptRegistry;
  dryRun?: boolean;
};

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
};

export type TopicRoutingTarget = {
  action: "update_existing" | "create_new";
  slug?: string;
  shortDescription?: string;
  topic: string;
  tags: string[];
};

export type TopicRoutingOptions = {
  model: string;
  logger?: Logger;
  promptRegistry: PromptRegistry;
  dryRun?: boolean;
};

export const DIGEST_RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    items: {
      type: "array",
      description:
        "Digest items generated from user notes. All textual fields must be in English.",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          category: {
            type: "string",
            enum: [...DIGEST_CATEGORIES],
          },
          source: {
            type: "string",
            enum: [...DIGEST_SOURCES],
          },
          summary: {
            type: "string",
            description:
              "Concise English summary of the item, regardless of input language.",
          },
          keyPoints: {
            type: "array",
            description:
              "Key points written in English, even when source notes are not in English.",
            items: {
              type: "string",
            },
          },
          timeline: {
            type: "array",
            description:
              "Timeline entries in English. Each entry must use strict ISO format: YYYY-MM-DD - <context>.",
            items: {
              type: "string",
            },
          },
          references: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                source: {
                  type: "string",
                  enum: [...DIGEST_SOURCES],
                },
                link: {
                  type: "string",
                },
              },
              required: ["source", "link"],
            },
          },
        },
        required: [
          "category",
          "source",
          "summary",
          "keyPoints",
          "timeline",
          "references",
        ],
      },
    },
  },
  required: ["items"],
} as const;

const TIMELINE_ENTRY_PATTERN = /^\d{4}-\d{2}-\d{2}\s+-\s+.+$/;
const ALLOWED_SOURCES_TEXT = DIGEST_SOURCES.join(", ");

export const TOPIC_ROUTING_RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    targets: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          action: {
            type: "string",
            enum: ["update_existing", "create_new"],
          },
          slug: { type: ["string", "null"] },
          shortDescription: { type: ["string", "null"] },
          topic: { type: "string" },
          tags: {
            type: "array",
            items: { type: "string" },
          },
        },
        required: ["action", "slug", "shortDescription", "topic", "tags"],
      },
    },
  },
  required: ["targets"],
} as const;

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

function normalizeSource(input: unknown): DigestSource | null {
  if (typeof input !== "string") {
    return null;
  }

  const value = input.trim().toLowerCase();

  if (value === "figma" || value === "file") {
    return "document";
  }

  if (
    value === "slack" ||
    value === "wiki" ||
    value === "git" ||
    value === "document"
  ) {
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

function normalizeReferences(input: unknown): DigestReference[] {
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

    const source = normalizeSource((item as { source?: unknown }).source);
    const link = (item as { link?: unknown }).link;

    if (!source) {
      throw new Error(
        `Digest item contained invalid reference source (expected one of: ${ALLOWED_SOURCES_TEXT})`,
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

export function parseDigestItemsResponse(content: string): DigestItem[] {
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
    const source = normalizeSource((item as { source?: unknown }).source);
    const summary = (item as { summary?: unknown }).summary;

    if (!category) {
      throw new Error("Digest item contained invalid category");
    }

    if (!source) {
      throw new Error(
        `Digest item contained invalid source (expected one of: ${ALLOWED_SOURCES_TEXT})`,
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
      ),
    });
  }

  if (digestItems.length === 0) {
    throw new Error("Digest response did not contain any valid digest items");
  }

  return digestItems;
}

export function renderDigestMarkdown(item: DigestItem): string {
  const keyPoints =
    item.keyPoints.length > 0
      ? item.keyPoints.map((value) => `- ${value}`).join("\n")
      : "- None";
  const timeline =
    item.timeline.length > 0
      ? item.timeline.map((value) => `- ${value}`).join("\n")
      : "- None";
  const references =
    item.references.length > 0
      ? item.references
          .map((value) => `- ${value.source}: ${value.link}`)
          .join("\n")
      : "- None";

  return [
    "## Summary",
    item.summary,
    "",
    "## Key Points",
    keyPoints,
    "",
    "## Timeline",
    timeline,
    "",
    "## References",
    references,
    "",
  ].join("\n");
}

export async function generateDigestItems(
  input: DigestGenerationInput,
  options: DigestGenerationOptions,
  chatCompletion?: (options: ChatCompletionOptions) => Promise<string>,
): Promise<DigestItem[]> {
  const inputText = typeof input === "string" ? input : input.text;
  const images = typeof input === "string" ? [] : (input.images ?? []);

  return executePromptOperation(
    options.promptRegistry,
    "digest",
    {
      inputText,
      images,
      allowedSources: DIGEST_SOURCES,
    },
    {
      model: options.model,
      logger: options.logger,
      dryRun: options.dryRun,
      chatCompletion,
    },
  );
}

export function parseTopicRoutingResponse(
  content: string,
  candidates: TopicRoutingCandidate[],
): TopicRoutingTarget[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error("Topic routing response was not valid JSON");
  }

  const rawTargets =
    parsed &&
    typeof parsed === "object" &&
    Array.isArray((parsed as { targets?: unknown[] }).targets)
      ? (parsed as { targets: unknown[] }).targets
      : null;

  if (!rawTargets || rawTargets.length === 0) {
    throw new Error("Topic routing response must include at least one target");
  }

  const validSlugs = new Set(candidates.map((candidate) => candidate.slug));
  const normalizedTargets: TopicRoutingTarget[] = [];

  for (const rawTarget of rawTargets) {
    if (!rawTarget || typeof rawTarget !== "object") {
      continue;
    }

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
        throw new Error(
          `Topic routing target referenced unknown slug: ${slug}`,
        );
      }

      normalizedTargets.push({
        action,
        slug,
        topic: topicValue.trim(),
        tags,
      });
      continue;
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

    normalizedTargets.push({
      action,
      shortDescription,
      topic: topicValue.trim(),
      tags,
    });
  }

  if (normalizedTargets.length === 0) {
    throw new Error("Topic routing response did not contain any valid targets");
  }

  return normalizedTargets;
}

export async function generateTopicTargets(
  item: DigestItem,
  candidates: TopicRoutingCandidate[],
  options: TopicRoutingOptions,
  chatCompletion?: (options: ChatCompletionOptions) => Promise<string>,
): Promise<TopicRoutingTarget[]> {
  return executePromptOperation(
    options.promptRegistry,
    "merge",
    {
      item,
      candidates,
    },
    {
      model: options.model,
      logger: options.logger,
      dryRun: options.dryRun,
      chatCompletion,
    },
  );
}
