import { resolveOpenAiChatCompletionsUrl } from "../config";
import {
  MissingEnvError,
  ModelRefusalError,
  UnsupportedModelError,
} from "../errors";

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string | ChatMessageContentPart[];
};

export type ChatMessageContentPart =
  | {
      type: "text";
      text: string;
    }
  | {
      type: "image_url";
      image_url: {
        url: string;
      };
    };

export type ChatCompletionOptions = {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  responseFormat?: ChatResponseFormat;
  logger?: {
    verbose: boolean;
    debug: (
      event: string,
      message: string,
      meta?: Record<string, unknown>,
    ) => Promise<void>;
    error: (
      event: string,
      message: string,
      meta?: Record<string, unknown>,
    ) => Promise<void>;
  };
};

type JsonSchemaResponseFormat = {
  type: "json_schema";
  json_schema: {
    name: string;
    strict: boolean;
    schema: Record<string, unknown>;
  };
};

type JsonObjectResponseFormat = {
  type: "json_object";
};

export type ChatResponseFormat =
  | JsonSchemaResponseFormat
  | JsonObjectResponseFormat;

type OpenAiChoice = {
  message?: {
    content?: string;
    refusal?: string;
  };
};

type OpenAiResponse = {
  choices?: OpenAiChoice[];
  error?: {
    message?: string;
  };
};

function formatMessageContentForLogging(
  content: ChatMessage["content"],
): string {
  if (typeof content === "string") {
    return content;
  }

  return content
    .map((part) => {
      if (part.type === "text") {
        return `text: ${part.text}`;
      }

      const url = part.image_url.url;
      const redactedUrl = url.startsWith("data:")
        ? `${url.slice(0, 48)}...<truncated>`
        : url;
      return `image_url: ${redactedUrl}`;
    })
    .join("\n");
}

export async function createChatCompletion(
  options: ChatCompletionOptions,
): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new MissingEnvError("OPENAI_API_KEY");
  }

  const endpoint = resolveOpenAiChatCompletionsUrl();
  const startedAt = Date.now();
  await options.logger?.debug(
    "ai.request.start",
    "Starting OpenAI chat completion request",
    {
      model: options.model,
      endpoint,
      messageCount: options.messages.length,
      responseFormatType: options.responseFormat?.type ?? null,
      prompt: options.logger?.verbose
        ? options.messages
            .map(
              (message) =>
                `${message.role}: ${formatMessageContentForLogging(message.content)}`,
            )
            .join("\n\n")
        : undefined,
    },
  );

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: options.model,
      messages: options.messages,
      temperature: options.temperature ?? 0.2,
      response_format: options.responseFormat,
      stream: false,
    }),
  });

  const rawPayload = (await response.json()) as OpenAiResponse;
  const durationMs = Date.now() - startedAt;

  if (!response.ok) {
    const message =
      rawPayload?.error?.message ??
      `OpenAI request failed with status ${response.status}`;

    await options.logger?.error(
      "ai.request.error",
      `OpenAI request failed: ${message}`,
      {
        model: options.model,
        endpoint,
        status: response.status,
        durationMs,
        response: options.logger?.verbose ? rawPayload : undefined,
      },
    );

    if (
      options.responseFormat?.type === "json_schema" &&
      /not supported|unsupported/i.test(message)
    ) {
      throw new UnsupportedModelError();
    }

    throw new Error(message);
  }

  const refusal = rawPayload?.choices?.[0]?.message?.refusal;
  if (typeof refusal === "string" && refusal.trim().length > 0) {
    throw new ModelRefusalError(refusal);
  }

  const content = rawPayload?.choices?.[0]?.message?.content;

  if (typeof content !== "string" || content.trim().length === 0) {
    throw new Error(
      "Malformed OpenAI response: missing choices[0].message.content",
    );
  }

  await options.logger?.debug(
    "ai.request.success",
    "OpenAI chat completion succeeded",
    {
      model: options.model,
      endpoint,
      status: response.status,
      durationMs,
      response: options.logger?.verbose ? content : undefined,
    },
  );

  return content;
}
