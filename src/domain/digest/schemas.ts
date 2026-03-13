import {
  DIGEST_CATEGORIES,
  DIGEST_SOURCES,
  type MergeContentInput,
} from "$/domain/digest/types";

export function buildDigestResponseSchema(allowedSources: readonly string[]) {
  return {
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
              enum: [...allowedSources],
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
                    enum: [...allowedSources],
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
}

export const DIGEST_RESPONSE_SCHEMA = buildDigestResponseSchema(DIGEST_SOURCES);

export const TOPIC_ROUTING_RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    target: {
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
  required: ["target"],
} as const;

export function buildMergeContentResponseSchema(
  input: MergeContentInput,
  allowedSources: readonly string[],
) {
  const shared = {
    category: {
      type: "string",
      enum: [input.category],
    },
    summary: { type: "string" },
    references: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          source: {
            type: "string",
            enum: [...allowedSources],
          },
          link: { type: "string" },
        },
        required: ["source", "link"],
      },
    },
    tags: {
      type: "array",
      items: { type: "string" },
    },
  } as const;

  if (input.category === "discussion") {
    return {
      type: "object",
      additionalProperties: false,
      properties: {
        ...shared,
        contextBackground: {
          type: "array",
          items: { type: "string" },
        },
        resolution: {
          type: "array",
          items: { type: "string" },
        },
        participants: {
          type: "array",
          items: { type: "string" },
        },
      },
      required: [
        "category",
        "summary",
        "contextBackground",
        "resolution",
        "participants",
        "references",
        "tags",
      ],
    } as const;
  }

  if (input.category === "research") {
    return {
      type: "object",
      additionalProperties: false,
      properties: {
        ...shared,
        problemStatement: {
          type: "array",
          items: { type: "string" },
        },
        researchPlan: {
          type: "array",
          items: { type: "string" },
        },
        keyFindings: {
          type: "array",
          items: { type: "string" },
        },
        personInCharge: {
          type: "array",
          items: { type: "string" },
        },
      },
      required: [
        "category",
        "summary",
        "problemStatement",
        "researchPlan",
        "keyFindings",
        "personInCharge",
        "references",
        "tags",
      ],
    } as const;
  }

  return {
    type: "object",
    additionalProperties: false,
    properties: {
      ...shared,
      objectivesSuccessCriteria: {
        type: "array",
        items: { type: "string" },
      },
      scope: {
        type: "array",
        items: { type: "string" },
      },
      deliverables: {
        type: "array",
        items: { type: "string" },
      },
      plan: {
        type: "array",
        items: { type: "string" },
      },
      timeline: {
        type: "array",
        items: { type: "string" },
      },
      teamsIndividualsInvolved: {
        type: "array",
        items: { type: "string" },
      },
    },
    required: [
      "category",
      "summary",
      "objectivesSuccessCriteria",
      "scope",
      "deliverables",
      "plan",
      "timeline",
      "teamsIndividualsInvolved",
      "references",
      "tags",
    ],
  } as const;
}

export const MERGE_CONTENT_RESPONSE_SCHEMA = buildMergeContentResponseSchema(
  {
    category: "planning",
    topic: "Release Cadence Policy",
    tags: ["release-cadence"],
    existing: {
      summary: "Current policy summary",
      objectivesSuccessCriteria: [],
      scope: [],
      deliverables: [],
      plan: [],
      timeline: [],
      teamsIndividualsInvolved: [],
      references: [],
    },
    incoming: {
      category: "planning",
      source: "slack",
      summary: "Incoming summary",
      keyPoints: [],
      timeline: [],
      references: [],
    },
    tagPool: [],
  },
  DIGEST_SOURCES,
);
