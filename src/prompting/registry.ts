import {
  DIGEST_RESPONSE_SCHEMA,
  parseDigestItemsResponse,
  parseTopicRoutingResponse,
  TOPIC_ROUTING_RESPONSE_SCHEMA,
} from "../digest";
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
  }>;
}): string {
  if (context.candidates.length === 0) {
    return "- No existing topic files";
  }

  return context.candidates
    .map((candidate) => {
      const tagsText =
        candidate.tags.length > 0 ? candidate.tags.join(", ") : "none";
      return `- slug: ${candidate.slug}; topic: ${candidate.topic}; tags: ${tagsText}; summary: ${candidate.summary}`;
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
          "Route this digest item into one or more topic files.",
          "Prefer update_existing when a candidate clearly matches.",
          "Use create_new when no candidate is a close match.",
          "You may return multiple targets if the digest item belongs in multiple existing topics.",
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
              name: "topic_routing_targets",
              strict: true,
              schema: TOPIC_ROUTING_RESPONSE_SCHEMA,
            },
          },
        };
      },
      parseResponse: (raw, context) =>
        parseTopicRoutingResponse(raw, context.candidates),
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
