import type { PromptRegistry } from "$/core/prompting/types";
import {
  parseDigestItemsResponse,
  parseMergeContentResponse,
  parseTopicRoutingResponse,
} from "$/domain/digest/parsers";
import {
  buildDigestResponseSchema,
  buildMergeContentResponseSchema,
  TOPIC_ROUTING_RESPONSE_SCHEMA,
} from "$/domain/digest/schemas";
import { DIGEST_SOURCES } from "$/domain/digest/types";
import {
  parseReportResponse,
  REPORT_RESPONSE_SCHEMA,
} from "$/domain/report/report";

function buildDigestUserText(
  inputText: string,
  allowedSourcesText: string,
): string {
  return [
    "Split the user content into one or more digest items.",
    "Return concise and meaningful digest items based on intent.",
    "Prefer fewer, meaningful digest items and avoid over-fragmenting.",
    "Always write summary, keyPoints, and timeline context in English, even if the user content is in another language.",
    "When source content includes explicit ownership/actor identities (for example author, merged_by, assignee, owner/PIC, or @mentions), preserve those identity cues in keyPoints.",
    "Timeline is optional when date information is unknown.",
    "Timeline entries must represent substantive events from the underlying project content (for example: decisions, incidents, milestones, findings, or completed actions).",
    "Do not include ingestion or tooling metadata in timeline (for example: import/search/sync/query operations, note creation, or file processing steps).",
    "If no substantive dated event is present, return an empty timeline array.",
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
    digestedCount?: number;
    updatedAt?: string;
    timeboxes?: string[];
    anchors?: string[];
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
      const timeboxesText =
        candidate.timeboxes && candidate.timeboxes.length > 0
          ? candidate.timeboxes.join(", ")
          : "none";
      const digestedCountText = String(candidate.digestedCount ?? 0);
      const updatedAtText =
        candidate.updatedAt && candidate.updatedAt.length > 0
          ? candidate.updatedAt
          : "unknown";
      const anchorsText =
        candidate.anchors && candidate.anchors.length > 0
          ? candidate.anchors.join(", ")
          : "none";
      return `- slug: ${candidate.slug}; topic: ${candidate.topic}; tags: ${tagsText}; summary: ${candidate.summary}; keyPoints: ${keyPointsText}; timeline: ${timelineText}; references: ${referencesText}; timeboxes: ${timeboxesText}; anchors: ${anchorsText}; digestedCount: ${digestedCountText}; updatedAt: ${updatedAtText}`;
    })
    .join("\n");
}

export function createBuiltInPromptRegistry(options?: {
  allowedSources?: readonly string[];
}): PromptRegistry {
  const allowedSources =
    options?.allowedSources && options.allowedSources.length > 0
      ? [...options.allowedSources]
      : [...DIGEST_SOURCES];
  const digestSchema = buildDigestResponseSchema(allowedSources);

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
              schema: digestSchema,
            },
          },
        };
      },
      parseResponse: (raw) =>
        parseDigestItemsResponse(raw, {
          allowedSources,
        }),
    },
    merge: {
      kind: "merge",
      version: "v1",
      buildPrompt: (context) => {
        const candidateText = buildMergeCandidateText(context);
        const prompt = [
          "Route this digest item into exactly one primary topic file.",
          "Prefer update_existing when a candidate clearly matches semantic scope.",
          "Default to workstream-level canonical topics, not note-level or PR-level topic files.",
          "Across all sources (git/slack/wiki/document), reuse an existing topic when domain + workstream + timebox are aligned.",
          "Treat product/project identity as a hard split key (for example project-atlas-api vs project-orion-web). Do not merge across distinct identities.",
          "Use create_new only when no candidate is a close match.",
          "Treat timebox as a hard split key when present (for example release/sprint/quarter). Do not merge across different timeboxes.",
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
        const mergeContentSchema = buildMergeContentResponseSchema(
          context,
          allowedSources,
        );
        const sectionGuidance =
          context.category === "decision"
            ? [
                "Return sections as: summary, decision, context, optionsConsidered, rationaleTradeoffs, stakeholders, references, tags.",
                "Decision should capture the chosen direction and concrete resolution.",
                "Context should capture relevant facts, constraints, and framing.",
                "Options Considered should list meaningful alternatives.",
                "Rationale / Tradeoffs should explain why the decision was chosen.",
                "Stakeholders should list teams/individuals involved in the decision.",
              ]
            : context.category === "research"
              ? [
                  "Return sections as: summary, problemStatement, researchPlan, keyFindings, personInCharge, references, tags.",
                  "Problem Statement should define the question or gap.",
                  "Research Plan should list experiments/investigation steps.",
                  "Key Findings should capture evidence-backed outcomes.",
                  "Person in Charge should list owners.",
                ]
              : [
                  "Return sections as: summary, objectivesSuccessCriteria, scope, deliverables, plan, timeline, teamsIndividualsInvolved, references, tags.",
                  "Timeline entries must stay in strict format: YYYY-MM-DD - <context>.",
                  "Teams/Individuals Involved must include explicitly named owners/actors from incoming content whenever present.",
                  "Format people with identity handles as either 'Display Name (platform:identity handle)' or '(platform:identity handle)'.",
                  "Use source-based platform labels (for example git, slack).",
                  "Objectives / Success Criteria should be concrete and measurable when possible.",
                ];
        const prompt = [
          "Merge the incoming digest content into the selected topic canonically.",
          "Keep only content directly relevant to the selected topic scope.",
          "Remove duplicates or near-duplicates from returned arrays.",
          "Do not introduce unrelated schedule/task details.",
          "Reuse tags from the provided tagPool whenever possible; only add new tags if necessary.",
          ...sectionGuidance,
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
              schema: mergeContentSchema,
            },
          },
        };
      },
      parseResponse: (raw, context) =>
        parseMergeContentResponse(raw, {
          category: context.category,
          allowedSources,
        }),
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
