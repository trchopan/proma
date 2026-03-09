import { type ChatCompletionOptions, createChatCompletion } from "./ai/openai";

export const DIGEST_CATEGORIES = [
  "planning",
  "research",
  "discussion",
] as const;

export const DIGEST_SOURCES = ["slack", "wiki", "git", "figma"] as const;

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
  references: DigestReference[];
};

export type DigestGenerationOptions = {
  model: string;
};

type ChatCompletionFn = (options: ChatCompletionOptions) => Promise<string>;

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

  if (
    value === "slack" ||
    value === "wiki" ||
    value === "git" ||
    value === "figma"
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
        "Digest item contained invalid reference source (expected one of: slack, wiki, git, figma)",
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

function extractJsonBlock(content: string): string {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced?.[1]) {
    return fenced[1];
  }

  return content;
}

function parseArrayPayload(payload: unknown): unknown[] {
  if (Array.isArray(payload)) {
    return payload;
  }

  if (payload && typeof payload === "object") {
    const digestItems = (payload as { items?: unknown }).items;
    if (Array.isArray(digestItems)) {
      return digestItems;
    }
  }

  throw new Error(
    "Digest response must be a JSON array or an object with an items array",
  );
}

export function parseDigestItemsResponse(content: string): DigestItem[] {
  const jsonText = extractJsonBlock(content);

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
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
        "Digest item contained invalid source (expected one of: slack, wiki, git, figma)",
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
    "## References",
    references,
    "",
  ].join("\n");
}

export async function generateDigestItems(
  inputText: string,
  options: DigestGenerationOptions,
  chatCompletion: ChatCompletionFn = createChatCompletion,
): Promise<DigestItem[]> {
  const prompt = [
    "Split the user content into one or more digest items.",
    "Return ONLY JSON. Use this shape:",
    '[{"category":"planning|research|discussion","source":"slack|wiki|git|figma","summary":"...","keyPoints":["..."],"references":[{"source":"slack|wiki|git|figma","link":"https://..."}]}]',
    "Do not include markdown or explanatory text.",
    "Prefer fewer, meaningful digest items and avoid over-fragmenting.",
    "Each item must include a source value from: slack, wiki, git, figma.",
    "If references are unknown, return an empty array. Do not use plain strings in references.",
    "User content:",
    inputText,
  ].join("\n\n");

  const responseText = await chatCompletion({
    model: options.model,
    temperature: 0.2,
    messages: [
      {
        role: "system",
        content: "You are a strict JSON formatter for digest classification.",
      },
      {
        role: "user",
        content: prompt,
      },
    ],
  });

  return parseDigestItemsResponse(responseText);
}
