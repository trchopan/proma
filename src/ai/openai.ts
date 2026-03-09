export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type ChatCompletionOptions = {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  responseFormat?: ChatResponseFormat;
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

const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com";

function resolveChatCompletionsUrl(): string {
  const configuredBaseUrl = process.env.OPENAI_BASE_URL?.trim();

  if (!configuredBaseUrl) {
    return `${DEFAULT_OPENAI_BASE_URL}/v1/chat/completions`;
  }

  const normalizedBaseUrl = configuredBaseUrl.replace(/\/+$/, "");

  if (normalizedBaseUrl.endsWith("/chat/completions")) {
    return normalizedBaseUrl;
  }

  if (normalizedBaseUrl.endsWith("/v1")) {
    return `${normalizedBaseUrl}/chat/completions`;
  }

  return `${normalizedBaseUrl}/v1/chat/completions`;
}

export async function createChatCompletion(
  options: ChatCompletionOptions,
): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error("Missing OPENAI_API_KEY environment variable");
  }

  const response = await fetch(resolveChatCompletionsUrl(), {
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

  if (!response.ok) {
    const message =
      rawPayload?.error?.message ??
      `OpenAI request failed with status ${response.status}`;

    if (
      options.responseFormat?.type === "json_schema" &&
      /response_format|json_schema|not supported|unsupported/i.test(message)
    ) {
      throw new Error(
        "Selected model does not support Structured Outputs (json_schema). Choose a compatible model.",
      );
    }

    throw new Error(message);
  }

  const refusal = rawPayload?.choices?.[0]?.message?.refusal;
  if (typeof refusal === "string" && refusal.trim().length > 0) {
    throw new Error(`Model refused structured output: ${refusal.trim()}`);
  }

  const content = rawPayload?.choices?.[0]?.message?.content;

  if (typeof content !== "string" || content.trim().length === 0) {
    throw new Error(
      "Malformed OpenAI response: missing choices[0].message.content",
    );
  }

  return content;
}
