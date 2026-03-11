import {
  parseDigestItemsResponse,
  parseMergeContentResponse,
  parseTopicRoutingResponse,
} from "../digest/parsers";
import {
  DIGEST_RESPONSE_SCHEMA,
  MERGE_CONTENT_RESPONSE_SCHEMA,
  TOPIC_ROUTING_RESPONSE_SCHEMA,
} from "../digest/schemas";
import { parseReportResponse, REPORT_RESPONSE_SCHEMA } from "../report";
import type { PromptRegistry } from "./types";

function buildDigestUserText(
  inputText: string,
  allowedSourcesText: string,
): string {
  return [
    "Split the user content into one or more digest items.",
    "Return concise and meaningful digest items based on intent.",
    "Prefer fewer, meaningful digest items and avoid over-fragmenting.",
    "Always write summary, keyPoints, and timeline context in English, even if the user content is in another language.",
    "Timeline is optional when date information is unknown.",
    "When timeline entries are present, each entry must use this strict format: YYYY-MM-DD - <context>.",
    `Each item must include a source value from: ${allowedSourcesText}.`,
    "If references are unknown, return an empty array.",
    "User content:",
    inputText,
  ].join("\n\n");
}

function buildMergeCandidateText(context: {
  candidates: Array<{
    slug: string;
    topic: string;
    tags: string[];
    summary: string;
    keyPoints: string[];
    timeline: string[];
    references: Array<{ source: string; link: string }>;
  }>;
}): string {
  if (context.candidates.length === 0) {
    return "- No existing topic files";
  }

  return context.candidates
    .map((candidate) => {
      const tagsText =
        candidate.tags.length > 0 ? candidate.tags.join(", ") : "none";
      const keyPointsText =
        candidate.keyPoints.length > 0
          ? candidate.keyPoints.slice(0, 4).join(" | ")
          : "none";
      const timelineText =
        candidate.timeline.length > 0
          ? candidate.timeline.slice(0, 3).join(" | ")
          : "none";
      const referencesText =
        candidate.references.length > 0
          ? candidate.references
              .slice(0, 3)
              .map((reference) => `${reference.source}: ${reference.link}`)
              .join(" | ")
          : "none";
      return `- slug: ${candidate.slug}; topic: ${candidate.topic}; tags: ${tagsText}; summary: ${candidate.summary}; keyPoints: ${keyPointsText}; timeline: ${timelineText}; references: ${referencesText}`;
    })
    .join("\n");
}

export function createBuiltInPromptRegistry(): PromptRegistry {
  return {
    digest: {
      kind: "digest",
      version: "v1",
      buildPrompt: (context) => {
        const allowedSourcesText = context.allowedSources.join(", ");
        const prompt = buildDigestUserText(
          context.inputText,
          allowedSourcesText,
        );
        const userContent =
          context.images.length === 0
            ? prompt
            : [
                { type: "text" as const, text: prompt },
                ...context.images.map((image) => ({
                  type: "image_url" as const,
                  image_url: { url: image.url },
                })),
              ];

        return {
          temperature: 0.2,
          messages: [
            {
              role: "system" as const,
              content:
                "You classify notes into digest items and must satisfy the provided response schema. Output all human-readable text in English.",
            },
            {
              role: "user" as const,
              content: userContent,
            },
          ],
          responseFormat: {
            type: "json_schema",
            json_schema: {
              name: "digest_items",
              strict: true,
              schema: DIGEST_RESPONSE_SCHEMA,
            },
          },
        };
      },
      parseResponse: (raw) => parseDigestItemsResponse(raw),
    },
    merge: {
      kind: "merge",
      version: "v1",
      buildPrompt: (context) => {
        const candidateText = buildMergeCandidateText(context);
        const prompt = [
          "Route this digest item into exactly one primary topic file.",
          "Prefer update_existing when a candidate clearly matches semantic scope.",
          "Use create_new only when no candidate is a close match.",
          "Avoid cross-topic contamination: do not mix policy decisions with release plan/schedule execution topics unless the digest is genuinely about both.",
          "Prefer reusing existing tags from candidates when possible; only add new tags when required.",
          "For create_new, provide shortDescription suitable for a kebab-case filename (max 100 characters after normalization).",
          "Return tags as concise lowercase phrases.",
          "Digest item:",
          JSON.stringify(context.item, null, 2),
          "Candidate topic files:",
          candidateText,
        ].join("\n\n");

        return {
          temperature: 0.2,
          messages: [
            {
              role: "system" as const,
              content:
                "You route digest items to topic files and must satisfy the provided response schema. Output all human-readable text in English.",
            },
            {
              role: "user" as const,
              content: prompt,
            },
          ],
          responseFormat: {
            type: "json_schema",
            json_schema: {
              name: "topic_routing_target",
              strict: true,
              schema: TOPIC_ROUTING_RESPONSE_SCHEMA,
            },
          },
        };
      },
      parseResponse: (raw, context) =>
        parseTopicRoutingResponse(raw, context.candidates),
    },
    merge_content: {
      kind: "merge_content",
      version: "v1",
      buildPrompt: (context) => {
        const prompt = [
          "Merge the incoming digest content into the selected topic canonically.",
          "Keep only content directly relevant to the selected topic scope.",
          "Remove duplicates or near-duplicates from key points and timeline.",
          "Do not introduce unrelated schedule/task details.",
          "Timeline entries must stay in strict format: YYYY-MM-DD - <context>.",
          "Reuse tags from the provided tagPool whenever possible; only add new tags if necessary.",
          "Selected topic context:",
          JSON.stringify(
            {
              category: context.category,
              topic: context.topic,
              tags: context.tags,
              existing: context.existing,
              tagPool: context.tagPool,
            },
            null,
            2,
          ),
          "Incoming digest item:",
          JSON.stringify(context.incoming, null, 2),
        ].join("\n\n");

        return {
          temperature: 0.2,
          messages: [
            {
              role: "system" as const,
              content:
                "You merge digest content into canonical topic content and must satisfy the provided response schema. Output all human-readable text in English.",
            },
            {
              role: "user" as const,
              content: prompt,
            },
          ],
          responseFormat: {
            type: "json_schema",
            json_schema: {
              name: "topic_merge_content",
              strict: true,
              schema: MERGE_CONTENT_RESPONSE_SCHEMA,
            },
          },
        };
      },
      parseResponse: (raw) => parseMergeContentResponse(raw),
    },
    report: {
      kind: "report",
      version: "v1",
      buildPrompt: (context) => {
        const prompt = [
          `Create a ${context.period} project report.`,
          "Use the input topic context as the current project state.",
          "Use base reports to continue the narrative and avoid restating resolved points as open items.",
          "Explicitly include:",
          "- Updated information since prior reports",
          "- Resolutions that are now complete",
          "- Clear next steps",
          "Input topic context:",
          JSON.stringify(context.inputs, null, 2),
          "Base report context:",
          JSON.stringify(context.baseReports, null, 2),
        ].join("\n\n");

        return {
          temperature: 0.2,
          messages: [
            {
              role: "system" as const,
              content:
                "You generate project reports and must satisfy the provided response schema. The report should continue context from prior reports while reflecting newly updated information.",
            },
            {
              role: "user" as const,
              content: prompt,
            },
          ],
          responseFormat: {
            type: "json_schema",
            json_schema: {
              name: "project_report",
              strict: true,
              schema: REPORT_RESPONSE_SCHEMA,
            },
          },
        };
      },
      parseResponse: (raw) => parseReportResponse(raw),
    },
  };
}
