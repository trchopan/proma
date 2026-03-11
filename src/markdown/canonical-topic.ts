import { DIGEST_SOURCES, type DigestSource } from "../digest/types";

export type CanonicalReference = { source: DigestSource; link: string };

export type CanonicalTopicData = {
  summary: string;
  keyPoints: string[];
  timeline: string[];
  references: CanonicalReference[];
};

export function extractTopicTitle(markdown: string): string {
  const titleLine = markdown
    .split("\n")
    .map((line) => line.trim())
    .find((line) => /^#\s+.+$/.test(line));

  return titleLine?.replace(/^#\s+/, "").trim() ?? "";
}

const TIMELINE_ENTRY_PATTERN = /^\d{4}-\d{2}-\d{2}\s+-\s+.+$/;

export function uniqueOrdered(values: string[]): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];

  for (const value of values) {
    const normalized = value.trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    ordered.push(normalized);
  }

  return ordered;
}

function parseReferenceKeyWithAllowedSources(
  value: string,
  allowedSources: readonly string[],
): CanonicalReference | null {
  const match = value.match(/^([a-z]+):\s*(.+)$/i);
  if (!match?.[1] || !match[2]) {
    return null;
  }

  const source = match[1].trim().toLowerCase();
  const link = match[2].trim();
  if (!allowedSources.includes(source) || !link) {
    return null;
  }

  return { source: source as DigestSource, link };
}

export function parseReferenceKey(value: string): CanonicalReference | null {
  return parseReferenceKeyWithAllowedSources(value, DIGEST_SOURCES);
}

export function parseTimelineEntry(value: string): string | null {
  const normalized = value.trim();
  if (!normalized || !TIMELINE_ENTRY_PATTERN.test(normalized)) {
    return null;
  }

  return normalized;
}

export function extractCanonicalTopicData(
  body: string,
  options?: { allowedSources?: readonly string[] },
): CanonicalTopicData {
  const allowedSources =
    options?.allowedSources && options.allowedSources.length > 0
      ? [...options.allowedSources]
      : [...DIGEST_SOURCES];
  const lines = body.split("\n");
  let section: "summary" | "keyPoints" | "timeline" | "references" | null =
    null;
  let summary = "";
  const keyPoints: string[] = [];
  const timeline: string[] = [];
  const references: CanonicalReference[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (/^##\s+Summary\s*$/i.test(line)) {
      section = "summary";
      continue;
    }
    if (/^##\s+Key Points\s*$/i.test(line)) {
      section = "keyPoints";
      continue;
    }
    if (/^##\s+Timeline\s*$/i.test(line)) {
      section = "timeline";
      continue;
    }
    if (/^##\s+References\s*$/i.test(line)) {
      section = "references";
      continue;
    }

    if (section === "summary" && line.length > 0 && !line.startsWith("#")) {
      if (!summary) {
        summary = line;
      }
      continue;
    }

    if (section === "keyPoints") {
      const bullet = line.match(/^-\s+(.+)$/);
      if (bullet?.[1] && bullet[1] !== "None") {
        keyPoints.push(bullet[1].trim());
      }
      continue;
    }

    if (section === "timeline") {
      const bullet = line.match(/^-\s+(.+)$/);
      if (!bullet?.[1] || bullet[1] === "None") {
        continue;
      }
      const parsed = parseTimelineEntry(bullet[1]);
      if (parsed) {
        timeline.push(parsed);
      }
      continue;
    }

    if (section === "references") {
      const bullet = line.match(/^-\s+(.+)$/);
      if (!bullet?.[1] || bullet[1] === "None") {
        continue;
      }
      const parsed = parseReferenceKeyWithAllowedSources(
        bullet[1],
        allowedSources,
      );
      if (parsed) {
        references.push(parsed);
      }
    }
  }

  const uniqueRefs = uniqueOrdered(
    references.map((reference) => `${reference.source}: ${reference.link}`),
  )
    .map((value) => parseReferenceKeyWithAllowedSources(value, allowedSources))
    .filter((value): value is CanonicalReference => Boolean(value));

  return {
    summary,
    keyPoints: uniqueOrdered(keyPoints),
    timeline: [...new Set(timeline)].sort((a, b) => a.localeCompare(b)),
    references: uniqueRefs,
  };
}

export function buildCanonicalBody(
  topic: string,
  data: CanonicalTopicData,
): string {
  const summary = data.summary || "No summary yet.";
  const keyPoints =
    data.keyPoints.length > 0
      ? data.keyPoints.map((value) => `- ${value}`).join("\n")
      : "- None";
  const timeline =
    data.timeline.length > 0
      ? data.timeline.map((value) => `- ${value}`).join("\n")
      : "- None";
  const references =
    data.references.length > 0
      ? data.references
          .map((value) => `- ${value.source}: ${value.link}`)
          .join("\n")
      : "- None";

  return [
    `# ${topic}`,
    "",
    "## Summary",
    summary,
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

export function firstMeaningfulLine(markdown: string): string {
  const lines = markdown
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));

  return lines[0] ?? "";
}
