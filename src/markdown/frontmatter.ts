import type { DigestCategory, DigestSource } from "../digest/types";

export type TopicFrontMatter = {
  category: DigestCategory;
  created_at: string;
  updated_at: string;
  tags: string[];
  sources: DigestSource[];
  digested_note_paths: string[];
};

export type ParsedTopicMetadata = Partial<TopicFrontMatter> & {};

export type ParsedFrontMatter = {
  metadata: ParsedTopicMetadata;
  body: string;
};

export function splitFrontMatter(markdown: string): {
  frontMatter: string;
  body: string;
} {
  if (!markdown.startsWith("---\n")) {
    return { frontMatter: "", body: markdown };
  }

  const end = markdown.indexOf("\n---\n", 4);
  if (end === -1) {
    return { frontMatter: "", body: markdown };
  }

  const frontMatter = markdown.slice(4, end);
  const body = markdown.slice(end + 5);

  return { frontMatter, body };
}

export function parseScalarFrontMatterEntries(
  frontMatter: string,
): Map<string, string> {
  const values = new Map<string, string>();
  const lines = frontMatter.split("\n");

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const match = line.match(/^([a-z_]+):\s*(.*)$/);
    if (!match?.[1]) {
      continue;
    }

    const key = match[1];
    const value = (match[2] ?? "").trim().replace(/^['"]|['"]$/g, "");
    values.set(key, value);
  }

  return values;
}

function parseStringArray(raw: string): string[] {
  if (!raw.startsWith("[") || !raw.endsWith("]")) {
    return [];
  }

  const inner = raw.slice(1, -1).trim();
  if (!inner) {
    return [];
  }

  return inner
    .split(",")
    .map((value) => value.trim())
    .map((value) => value.replace(/^['"]|['"]$/g, ""))
    .filter((value) => value.length > 0);
}

export function parseFrontMatter(markdown: string): ParsedFrontMatter {
  const { frontMatter, body } = splitFrontMatter(markdown);
  if (!frontMatter) {
    return { metadata: {}, body };
  }

  const metadata: ParsedTopicMetadata = {};
  const lines = frontMatter.split("\n");
  const arrayKeys = new Set([
    "tags",
    "sources",
    "digested_note_paths",
    "merged_digest_ids",
  ]);

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]?.trim() ?? "";
    if (!line || line.startsWith("#")) {
      continue;
    }

    const match = line.match(/^([a-z_]+):\s*(.*)$/);
    if (!match) {
      continue;
    }

    const key = match[1] ?? "";
    const value = (match[2] ?? "").trim();

    if (arrayKeys.has(key)) {
      if (value) {
        const parsedInline = parseStringArray(value);
        if (key === "tags") metadata.tags = parsedInline;
        if (key === "sources")
          metadata.sources = parsedInline as DigestSource[];
        if (key === "digested_note_paths")
          metadata.digested_note_paths = parsedInline;
        if (key === "merged_digest_ids")
          metadata.digested_note_paths = parsedInline;
        continue;
      }

      const values: string[] = [];
      for (let j = i + 1; j < lines.length; j += 1) {
        const itemLine = lines[j] ?? "";
        const itemMatch = itemLine.match(/^\s*-\s+(.+)$/);
        if (!itemMatch?.[1]) {
          break;
        }
        values.push(itemMatch[1].trim().replace(/^['"]|['"]$/g, ""));
        i = j;
      }

      if (key === "tags") metadata.tags = values;
      if (key === "sources") metadata.sources = values as DigestSource[];
      if (key === "digested_note_paths") metadata.digested_note_paths = values;
      if (key === "merged_digest_ids") metadata.digested_note_paths = values;
      continue;
    }

    const scalar = value.replace(/^['"]|['"]$/g, "");
    if (key === "category") metadata.category = scalar as DigestCategory;
    if (key === "created_at") metadata.created_at = scalar;
    if (key === "updated_at") metadata.updated_at = scalar;
  }

  return { metadata, body };
}

function yamlQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export function serializeFrontMatter(metadata: TopicFrontMatter): string {
  return [
    "---",
    `category: ${metadata.category}`,
    `created_at: ${yamlQuote(metadata.created_at)}`,
    `updated_at: ${yamlQuote(metadata.updated_at)}`,
    "tags:",
    ...metadata.tags.map((tag) => `  - ${yamlQuote(tag)}`),
    "sources:",
    ...metadata.sources.map((source) => `  - ${source}`),
    "digested_note_paths:",
    ...metadata.digested_note_paths.map((id) => `  - ${yamlQuote(id)}`),
    "---",
    "",
  ].join("\n");
}
