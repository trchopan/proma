import { expect, test } from "bun:test";

import {
  DIGEST_RESPONSE_SCHEMA,
  type DigestItem,
  generateDigestItems,
  generateTopicTargets,
  parseDigestItemsResponse,
  parseTopicRoutingResponse,
  renderDigestMarkdown,
  TOPIC_ROUTING_RESPONSE_SCHEMA,
} from "../src/digest";

test("parseDigestItemsResponse accepts structured items object", () => {
  const response = JSON.stringify({
    items: [
      {
        category: "planning",
        source: "slack",
        summary: "Plan Q2 launch milestones.",
        keyPoints: ["Draft timeline", "Define dependencies"],
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
        references: [],
      },
    ],
  });

  expect(() => parseDigestItemsResponse(response)).toThrow(
    "Digest item contained invalid source",
  );
});

test("parseDigestItemsResponse rejects invalid category", () => {
  const response = JSON.stringify({
    items: [
      {
        category: "ops",
        summary: "Invalid category sample",
        keyPoints: [],
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
    references: [{ source: "wiki", link: "https://example.com/onboarding" }],
  };

  const markdown = renderDigestMarkdown(item);

  expect(markdown).toContain("## Summary");
  expect(markdown).toContain("## Key Points");
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
        references: [{ source: "drive", link: "https://example.com/doc" }],
      },
    ],
  });

  expect(() => parseDigestItemsResponse(response)).toThrow(
    "Digest item contained invalid reference source",
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
    { model: "gpt-4o-mini" },
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
    | Array<{ role: string; content: string }>
    | undefined;
  const promptText =
    messages?.map((message) => message.content).join("\n") ?? "";

  expect(promptText).toContain("in English");
});

test("parseTopicRoutingResponse rejects unknown slug for update target", () => {
  const response = JSON.stringify({
    targets: [
      {
        action: "update_existing",
        slug: "unknown-topic",
        topic: "Unknown",
        tags: [],
      },
    ],
  });

  expect(() =>
    parseTopicRoutingResponse(response, [
      {
        slug: "known-topic",
        topic: "Known",
        tags: [],
        summary: "Known summary",
      },
    ]),
  ).toThrow("unknown slug");
});

test("generateTopicTargets passes candidate slugs and strict schema", async () => {
  let capturedOptions:
    | {
        messages?: unknown;
        responseFormat?: unknown;
      }
    | undefined;

  const targets = await generateTopicTargets(
    {
      category: "planning",
      source: "slack",
      summary: "Plan release tasks",
      keyPoints: ["Prepare QA"],
      references: [],
    },
    [
      {
        slug: "release-readiness",
        topic: "Release Readiness",
        tags: ["release"],
        summary: "Release checklist",
      },
    ],
    { model: "gpt-4o-mini" },
    async (options) => {
      capturedOptions = {
        messages: options.messages,
        responseFormat: options.responseFormat,
      };

      return JSON.stringify({
        targets: [
          {
            action: "update_existing",
            slug: "release-readiness",
            topic: "Release Readiness",
            tags: ["release"],
          },
        ],
      });
    },
  );

  expect(targets).toEqual([
    {
      action: "update_existing",
      slug: "release-readiness",
      topic: "Release Readiness",
      tags: ["release"],
    },
  ]);

  expect(capturedOptions?.responseFormat).toEqual({
    type: "json_schema",
    json_schema: {
      name: "topic_routing_targets",
      strict: true,
      schema: TOPIC_ROUTING_RESPONSE_SCHEMA,
    },
  });

  const messages = capturedOptions?.messages as
    | Array<{ role: string; content: string }>
    | undefined;
  const promptText =
    messages?.map((message) => message.content).join("\n") ?? "";

  expect(promptText).toContain("release-readiness");
});
