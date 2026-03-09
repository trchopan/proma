import { afterEach, expect, test } from "bun:test";

import {
  type ChatResponseFormat,
  createChatCompletion,
} from "../src/ai/openai";

const originalFetch = globalThis.fetch;
const originalApiKey = process.env.OPENAI_API_KEY;

afterEach(() => {
  globalThis.fetch = originalFetch;
  process.env.OPENAI_API_KEY = originalApiKey;
});

test("createChatCompletion sends response_format payload", async () => {
  process.env.OPENAI_API_KEY = "test-key";

  let capturedBody: Record<string, unknown> | undefined;
  globalThis.fetch = (async (
    _input: string | URL | Request,
    init?: RequestInit,
  ) => {
    if (!init?.body || typeof init.body !== "string") {
      throw new Error("Expected request body");
    }

    capturedBody = JSON.parse(init.body) as Record<string, unknown>;

    return new Response(
      JSON.stringify({
        choices: [{ message: { content: '{"items":[]}' } }],
      }),
      { status: 200 },
    );
  }) as unknown as typeof fetch;

  const responseFormat: ChatResponseFormat = {
    type: "json_schema",
    json_schema: {
      name: "digest_items",
      strict: true,
      schema: {
        type: "object",
      },
    },
  };

  await createChatCompletion({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: "Hello" }],
    responseFormat,
  });

  expect(capturedBody?.response_format).toEqual(responseFormat);
});

test("createChatCompletion forwards multimodal message content", async () => {
  process.env.OPENAI_API_KEY = "test-key";

  let capturedBody: Record<string, unknown> | undefined;
  globalThis.fetch = (async (
    _input: string | URL | Request,
    init?: RequestInit,
  ) => {
    if (!init?.body || typeof init.body !== "string") {
      throw new Error("Expected request body");
    }

    capturedBody = JSON.parse(init.body) as Record<string, unknown>;

    return new Response(
      JSON.stringify({
        choices: [{ message: { content: "ok" } }],
      }),
      { status: 200 },
    );
  }) as unknown as typeof fetch;

  await createChatCompletion({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "Check this" },
          {
            type: "image_url",
            image_url: { url: "data:image/png;base64,abc" },
          },
        ],
      },
    ],
  });

  expect(capturedBody?.messages).toEqual([
    {
      role: "user",
      content: [
        { type: "text", text: "Check this" },
        {
          type: "image_url",
          image_url: { url: "data:image/png;base64,abc" },
        },
      ],
    },
  ]);
});

test("createChatCompletion fails fast for unsupported json_schema models", async () => {
  process.env.OPENAI_API_KEY = "test-key";

  globalThis.fetch = (async () => {
    return new Response(
      JSON.stringify({
        error: {
          message:
            "Invalid parameter: response_format with json_schema is not supported for this model.",
        },
      }),
      { status: 400 },
    );
  }) as unknown as typeof fetch;

  await expect(
    createChatCompletion({
      model: "gpt-4.1",
      messages: [{ role: "user", content: "Hello" }],
      responseFormat: {
        type: "json_schema",
        json_schema: {
          name: "digest_items",
          strict: true,
          schema: { type: "object" },
        },
      },
    }),
  ).rejects.toThrow(
    "Selected model does not support Structured Outputs (json_schema). Choose a compatible model.",
  );
});

test("createChatCompletion surfaces refusal from model", async () => {
  process.env.OPENAI_API_KEY = "test-key";

  globalThis.fetch = (async () => {
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              refusal: "I cannot comply with that request.",
            },
          },
        ],
      }),
      { status: 200 },
    );
  }) as unknown as typeof fetch;

  await expect(
    createChatCompletion({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: "Hello" }],
    }),
  ).rejects.toThrow("Model refused structured output");
});

test("createChatCompletion logs full prompt and response in verbose mode", async () => {
  process.env.OPENAI_API_KEY = "test-key";

  globalThis.fetch = (async () => {
    return new Response(
      JSON.stringify({
        choices: [{ message: { content: "full response body" } }],
      }),
      { status: 200 },
    );
  }) as unknown as typeof fetch;

  const debugEvents: Array<{ event: string; meta?: Record<string, unknown> }> =
    [];
  const errorEvents: Array<{ event: string; meta?: Record<string, unknown> }> =
    [];

  await createChatCompletion({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: "full prompt body" }],
    logger: {
      verbose: true,
      debug: async (event, _message, meta) => {
        debugEvents.push({ event, meta });
      },
      error: async (event, _message, meta) => {
        errorEvents.push({ event, meta });
      },
    },
  });

  expect(errorEvents).toHaveLength(0);

  const startEvent = debugEvents.find(
    (value) => value.event === "ai.request.start",
  );
  const successEvent = debugEvents.find(
    (value) => value.event === "ai.request.success",
  );

  expect(startEvent?.meta?.prompt).toBe("user: full prompt body");
  expect(successEvent?.meta?.response).toBe("full response body");
});
