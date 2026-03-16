import { expect, test } from "bun:test";
import { createBuiltInPromptRegistry } from "$/core/prompting/registry";
import {
  generateDigestItems,
  generateMergeContent,
  generateTopicTarget,
} from "$/domain/digest/generate";
import {
  parseDigestItemsResponse,
  parseMergeContentResponse,
  parseTopicRoutingResponse,
} from "$/domain/digest/parsers";
import { renderDigestMarkdown } from "$/domain/digest/render";
import {
  DIGEST_RESPONSE_SCHEMA,
  MERGE_CONTENT_RESPONSE_SCHEMA,
  TOPIC_ROUTING_RESPONSE_SCHEMA,
} from "$/domain/digest/schemas";
import { DIGEST_SOURCES, type DigestItem } from "$/domain/digest/types";

test("parseDigestItemsResponse accepts structured items object", () => {
  const response = JSON.stringify({
    items: [
      {
        category: "planning",
        source: "slack",
        summary: "Plan Q2 launch milestones.",
        keyPoints: ["Draft timeline", "Define dependencies"],
        timeline: ["2026-04-15 - Draft timeline approved"],
        references: [{ source: "slack", link: "https://example.com/plan" }],
      },
    ],
  });

  const items = parseDigestItemsResponse(response);

  expect(items).toHaveLength(1);
  expect(items[0]).toEqual({
    category: "planning",
    source: "slack",
    summary: "Plan Q2 launch milestones.",
    keyPoints: ["Draft timeline", "Define dependencies"],
    timeline: ["2026-04-15 - Draft timeline approved"],
    references: [{ source: "slack", link: "https://example.com/plan" }],
  });
});

test("parseDigestItemsResponse rejects invalid source", () => {
  const response = JSON.stringify({
    items: [
      {
        category: "planning",
        source: "notion",
        summary: "Invalid source sample",
        keyPoints: [],
        timeline: ["2026-04-15 - Context"],
        references: [],
      },
    ],
  });

  expect(() => parseDigestItemsResponse(response)).toThrow(
    "Digest item contained invalid source",
  );
});

test("parseDigestItemsResponse accepts configured custom source", () => {
  const response = JSON.stringify({
    items: [
      {
        category: "planning",
        source: "jira",
        summary: "Track release blockers",
        keyPoints: ["Capture owner"],
        timeline: ["2026-04-15 - Blocker triage"],
        references: [{ source: "jira", link: "https://example.com/TICKET-1" }],
      },
    ],
  });

  const items = parseDigestItemsResponse(response, {
    allowedSources: [...DIGEST_SOURCES, "jira"],
  });

  expect(items[0]?.source).toBe("jira");
  expect(items[0]?.references[0]?.source).toBe("jira");
});

test("parseDigestItemsResponse rejects invalid category", () => {
  const response = JSON.stringify({
    items: [
      {
        category: "ops",
        summary: "Invalid category sample",
        keyPoints: [],
        timeline: ["2026-04-15 - Context"],
        references: [],
      },
    ],
  });

  expect(() => parseDigestItemsResponse(response)).toThrow(
    "Digest item contained invalid category",
  );
});

test("parseDigestItemsResponse accepts decision category", () => {
  const response = JSON.stringify({
    items: [
      {
        category: "decision",
        source: "slack",
        summary: "Choose rollout strategy for API gateway.",
        keyPoints: ["Adopt blue/green rollout"],
        timeline: ["2026-04-15 - Rollout strategy approved"],
        references: [],
      },
    ],
  });

  const items = parseDigestItemsResponse(response);
  expect(items[0]?.category).toBe("decision");
});

test("parseDigestItemsResponse rejects legacy discussion category", () => {
  const response = JSON.stringify({
    items: [
      {
        category: "discussion",
        source: "slack",
        summary: "Legacy category should fail",
        keyPoints: [],
        timeline: [],
        references: [],
      },
    ],
  });

  expect(() => parseDigestItemsResponse(response)).toThrow(
    "Digest item contained invalid category",
  );
});

test("renderDigestMarkdown always includes required sections", () => {
  const item: DigestItem = {
    category: "research",
    source: "wiki",
    summary: "Compare competitor onboarding patterns.",
    keyPoints: ["Analyze signup funnel", "Review activation metrics"],
    timeline: ["2026-04-20 - Complete onboarding benchmark"],
    references: [{ source: "wiki", link: "https://example.com/onboarding" }],
  };

  const markdown = renderDigestMarkdown(item);

  expect(markdown).toContain("## Summary");
  expect(markdown).toContain("## Key Points");
  expect(markdown).toContain("## Timeline");
  expect(markdown).toContain("## References");
  expect(markdown).toContain("- wiki: https://example.com/onboarding");
});

test("parseDigestItemsResponse rejects invalid reference source", () => {
  const response = JSON.stringify({
    items: [
      {
        category: "planning",
        source: "slack",
        summary: "Reference source should fail",
        keyPoints: [],
        timeline: ["2026-04-15 - Context"],
        references: [{ source: "drive", link: "https://example.com/doc" }],
      },
    ],
  });

  expect(() => parseDigestItemsResponse(response)).toThrow(
    "Digest item contained invalid reference source",
  );
});

test("parseDigestItemsResponse rejects empty reference link", () => {
  const response = JSON.stringify({
    items: [
      {
        category: "planning",
        source: "slack",
        summary: "Reference link should fail",
        keyPoints: [],
        timeline: ["2026-04-15 - Context"],
        references: [{ source: "slack", link: "" }],
      },
    ],
  });

  expect(() => parseDigestItemsResponse(response)).toThrow(
    "Digest item contained empty reference link",
  );
});

test("generateDigestItems passes strict structured output format", async () => {
  const output = {
    items: [
      {
        category: "research",
        source: "wiki",
        summary: "Capture rollout constraints.",
        keyPoints: ["Track blockers"],
        timeline: ["2026-04-15 - Capture rollout constraints"],
        references: [],
      },
    ],
  };

  let capturedOptions:
    | {
        messages?: unknown;
        responseFormat?: unknown;
      }
    | undefined;

  const items = await generateDigestItems(
    "Some input",
    {
      model: "gpt-4o-mini",
      promptRegistry: createBuiltInPromptRegistry(),
    },
    async (options) => {
      capturedOptions = {
        messages: options.messages,
        responseFormat: options.responseFormat,
      };
      return JSON.stringify(output);
    },
  );

  expect(items).toHaveLength(1);
  expect(capturedOptions?.responseFormat).toEqual({
    type: "json_schema",
    json_schema: {
      name: "digest_items",
      strict: true,
      schema: DIGEST_RESPONSE_SCHEMA,
    },
  });

  const messages = capturedOptions?.messages as
    | Array<{ role: string; content: string | unknown[] }>
    | undefined;
  const promptText =
    messages
      ?.map((message) =>
        typeof message.content === "string"
          ? message.content
          : JSON.stringify(message.content),
      )
      .join("\n") ?? "";

  expect(promptText).toContain("You classify notes into digest items");
  expect(promptText).toContain("slack, wiki, git, document");
  expect(promptText).toContain(
    "When source content includes explicit ownership/actor identities",
  );
  expect(promptText).toContain(
    "Timeline entries must represent substantive events",
  );
  expect(promptText).toContain(
    "Do not include ingestion or tooling metadata in timeline",
  );
  expect(promptText).toContain(
    "If no substantive dated event is present, return an empty timeline array.",
  );
  expect(promptText).toContain(
    "Each reference link must be a non-empty, source-backed URL or locator string",
  );
  expect(promptText).toContain("Some input");
});

test("digest response schema requires non-empty reference links", () => {
  const itemSchema = DIGEST_RESPONSE_SCHEMA.properties.items
    .items as unknown as {
    properties: {
      references: {
        items: {
          properties: {
            link: { minLength?: number };
          };
        };
      };
    };
  };

  expect(itemSchema.properties.references.items.properties.link.minLength).toBe(
    1,
  );
});

test("generateDigestItems includes image parts for multimodal prompt", async () => {
  let capturedOptions:
    | {
        messages?: unknown;
      }
    | undefined;

  await generateDigestItems(
    {
      text: "Here is the note content",
      images: [
        {
          label: "image.png",
          url: "data:image/png;base64,abc123",
        },
      ],
    },
    {
      model: "gpt-4o-mini",
      promptRegistry: createBuiltInPromptRegistry(),
    },
    async (options) => {
      capturedOptions = {
        messages: options.messages,
      };
      return JSON.stringify({
        items: [
          {
            category: "planning",
            source: "wiki",
            summary: "Summary",
            keyPoints: [],
            timeline: ["2026-04-15 - Context"],
            references: [],
          },
        ],
      });
    },
  );

  const userMessage = (
    capturedOptions?.messages as
      | Array<{
          role: string;
          content:
            | string
            | Array<
                | { type: "text"; text: string }
                | { type: "image_url"; image_url: { url: string } }
              >;
        }>
      | undefined
  )?.find((message) => message.role === "user");

  expect(Array.isArray(userMessage?.content)).toBe(true);
  const contentParts = userMessage?.content as
    | Array<
        | { type: "text"; text: string }
        | { type: "image_url"; image_url: { url: string } }
      >
    | undefined;
  expect(contentParts?.[0]).toEqual({
    type: "text",
    text: expect.stringContaining("User content:"),
  });
  expect(contentParts?.[1]).toEqual({
    type: "image_url",
    image_url: {
      url: "data:image/png;base64,abc123",
    },
  });
});

test("parseTopicRoutingResponse rejects unknown slug for update target", () => {
  const response = JSON.stringify({
    target: {
      action: "update_existing",
      slug: "unknown-topic",
      topic: "Unknown",
      tags: [],
    },
  });

  expect(() =>
    parseTopicRoutingResponse(response, [
      {
        slug: "known-topic",
        topic: "Known",
        tags: [],
        summary: "Known summary",
        keyPoints: [],
        timeline: [],
        references: [],
      },
    ]),
  ).toThrow("unknown slug");
});

test("parseTopicRoutingResponse rejects null slug for update_existing", () => {
  const response = JSON.stringify({
    target: {
      action: "update_existing",
      slug: null,
      topic: "Known",
      tags: [],
    },
  });

  expect(() =>
    parseTopicRoutingResponse(response, [
      {
        slug: "known-topic",
        topic: "Known",
        tags: [],
        summary: "Known summary",
        keyPoints: [],
        timeline: [],
        references: [],
      },
    ]),
  ).toThrow("must include a slug");
});

test("topic routing schema stays OpenAI-compatible with flat target object", () => {
  const targetSchema = TOPIC_ROUTING_RESPONSE_SCHEMA.properties
    .target as unknown as {
    type: string;
    properties: {
      action: { enum: string[] };
      slug: { type: string[] };
    };
  };

  expect(targetSchema.type).toBe("object");
  expect(targetSchema.properties.action.enum).toEqual([
    "update_existing",
    "create_new",
  ]);
  expect(targetSchema.properties.slug.type).toEqual(["string", "null"]);
});

test("generateTopicTarget passes candidate slugs and strict schema", async () => {
  let capturedOptions:
    | {
        messages?: unknown;
        responseFormat?: unknown;
      }
    | undefined;

  const target = await generateTopicTarget(
    {
      category: "planning",
      source: "slack",
      summary: "Plan release tasks",
      keyPoints: ["Prepare QA"],
      timeline: ["2026-04-15 - Confirm release plan"],
      references: [],
    },
    [
      {
        slug: "release-readiness",
        topic: "Release Readiness",
        tags: ["release"],
        summary: "Release checklist",
        keyPoints: ["Confirm QA readiness"],
        timeline: ["2026-04-01 - Checklist created"],
        references: [],
      },
    ],
    {
      model: "gpt-4o-mini",
      promptRegistry: createBuiltInPromptRegistry(),
    },
    async (options) => {
      capturedOptions = {
        messages: options.messages,
        responseFormat: options.responseFormat,
      };

      return JSON.stringify({
        target: {
          action: "update_existing",
          slug: "release-readiness",
          topic: "Release Readiness",
          tags: ["release"],
        },
      });
    },
  );

  expect(target).toEqual({
    action: "update_existing",
    slug: "release-readiness",
    topic: "Release Readiness",
    tags: ["release"],
  });

  expect(capturedOptions?.responseFormat).toEqual({
    type: "json_schema",
    json_schema: {
      name: "topic_routing_target",
      strict: true,
      schema: TOPIC_ROUTING_RESPONSE_SCHEMA,
    },
  });

  const messages = capturedOptions?.messages as
    | Array<{ role: string; content: string }>
    | undefined;
  const promptText =
    messages?.map((message) => message.content).join("\n") ?? "";

  expect(promptText).toContain("You route digest items to topic files");
  expect(promptText).toContain("classify artifact_type internally");
  expect(promptText).toContain(
    "Only canonical_topic should justify create_new",
  );
  expect(promptText).toContain(
    "create_new must still be a broad durable roll-up topic",
  );
  expect(promptText).toContain(
    "If action is update_existing, slug must be a non-empty slug",
  );
  expect(promptText).toContain(
    "If no candidate slug is suitable, use create_new instead",
  );
  expect(promptText).not.toContain("No canonical topic required");
  expect(promptText).toContain("release-readiness");
  expect(promptText).toContain("workstream-level canonical topics");
  expect(promptText).toContain("Treat timebox as a hard split key");
  expect(promptText).toContain(
    "Treat product/project identity as a hard split key",
  );
  expect(promptText).toContain("Avoid near-duplicate create_new identities");
  expect(promptText).toContain("include at least one durable differentiator");
});

test("parseMergeContentResponse validates canonical merge payload", () => {
  const response = JSON.stringify({
    category: "planning",
    summary: "Merged release policy summary",
    objectivesSuccessCriteria: ["Keep monthly cadence"],
    scope: ["Release policy decisions"],
    deliverables: ["Updated policy doc"],
    plan: ["Review policy monthly"],
    timeline: ["2026-03-13 - Publish decision"],
    teamsIndividualsInvolved: ["Release managers"],
    references: [{ source: "slack", link: "https://example.com/thread" }],
    tags: ["release-cadence", "hotfix-process"],
  });

  const parsed = parseMergeContentResponse(response, {
    category: "planning",
  });

  expect(parsed.category).toBe("planning");
  expect(parsed.summary).toBe("Merged release policy summary");
  if (parsed.category !== "planning") {
    throw new Error("Expected planning merge payload");
  }
  expect(parsed.timeline).toEqual(["2026-03-13 - Publish decision"]);
  expect(parsed.references).toEqual([
    { source: "slack", link: "https://example.com/thread" },
  ]);
});

test("parseMergeContentResponse parses decision merge payload", () => {
  const response = JSON.stringify({
    category: "decision",
    summary: "Adopt blue/green deployment for API gateway rollout.",
    decision: ["Proceed with blue/green deployment for v2 API gateway."],
    context: ["Canary-only approach increased rollback complexity."],
    optionsConsidered: [
      "Keep canary rollout as-is",
      "Use blue/green with staged traffic shift",
    ],
    rationaleTradeoffs: [
      "Blue/green improves rollback at the cost of temporary infra overhead.",
    ],
    stakeholders: ["Platform Team", "SRE"],
    references: [{ source: "slack", link: "https://example.com/thread" }],
    tags: ["api-gateway", "rollout"],
  });

  const parsed = parseMergeContentResponse(response, {
    category: "decision",
  });

  expect(parsed.category).toBe("decision");
  if (parsed.category !== "decision") {
    throw new Error("Expected decision merge payload");
  }
  expect(parsed.decision).toEqual([
    "Proceed with blue/green deployment for v2 API gateway.",
  ]);
  expect(parsed.stakeholders).toEqual(["Platform Team", "SRE"]);
});

test("generateMergeContent uses strict schema", async () => {
  let capturedOptions:
    | {
        messages?: unknown;
        responseFormat?: unknown;
      }
    | undefined;

  const output = await generateMergeContent(
    {
      category: "planning",
      topic: "Release Cadence Policy",
      tags: ["release-cadence"],
      existing: {
        summary: "Existing summary",
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
        keyPoints: ["Keep cadence"],
        timeline: ["2026-03-13 - Decision"],
        references: [],
      },
      tagPool: ["release-cadence"],
    },
    {
      model: "gpt-4o-mini",
      promptRegistry: createBuiltInPromptRegistry(),
    },
    async (options) => {
      capturedOptions = {
        messages: options.messages,
        responseFormat: options.responseFormat,
      };
      return JSON.stringify({
        category: "planning",
        summary: "Refined summary",
        objectivesSuccessCriteria: ["Keep cadence"],
        scope: [],
        deliverables: [],
        plan: [],
        timeline: ["2026-03-13 - Decision"],
        teamsIndividualsInvolved: [],
        references: [],
        tags: ["release-cadence"],
      });
    },
  );

  expect(output.summary).toBe("Refined summary");
  expect(capturedOptions?.responseFormat).toEqual({
    type: "json_schema",
    json_schema: {
      name: "topic_merge_content",
      strict: true,
      schema: MERGE_CONTENT_RESPONSE_SCHEMA,
    },
  });

  const messages = capturedOptions?.messages as
    | Array<{ role: string; content: string }>
    | undefined;
  const promptText =
    messages?.map((message) => message.content).join("\n") ?? "";

  expect(promptText).toContain(
    "When generating reasoning sections (for example Decision Drivers, Rationale, Tradeoffs)",
  );
  expect(promptText).toContain("do not fabricate detailed rationale");
  expect(promptText).toContain("keep inference minimal");
});

test("parseDigestItemsResponse rejects invalid timeline format", () => {
  const response = JSON.stringify({
    items: [
      {
        category: "planning",
        source: "slack",
        summary: "Timeline should use ISO date with context",
        keyPoints: ["Keep timeline valid"],
        timeline: ["April 15 - Kickoff"],
        references: [],
      },
    ],
  });

  expect(() => parseDigestItemsResponse(response)).toThrow(
    "Digest item contained invalid timeline entry (expected format: YYYY-MM-DD - <context>)",
  );
});

test("parseDigestItemsResponse defaults missing timeline to empty array", () => {
  const response = JSON.stringify({
    items: [
      {
        category: "planning",
        source: "slack",
        summary: "Missing timeline should default",
        keyPoints: ["Keep schema strict"],
        references: [],
      },
    ],
  });

  const items = parseDigestItemsResponse(response);

  expect(items[0]?.timeline).toEqual([]);
});
