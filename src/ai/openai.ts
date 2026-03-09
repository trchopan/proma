export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type ChatCompletionOptions = {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
};

type OpenAiChoice = {
  message?: {
    content?: string;
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
      stream: false,
    }),
  });

  const rawPayload = (await response.json()) as OpenAiResponse;

  if (!response.ok) {
    const message =
      rawPayload?.error?.message ??
      `OpenAI request failed with status ${response.status}`;
    throw new Error(message);
  }

  const content = rawPayload?.choices?.[0]?.message?.content;

  if (typeof content !== "string" || content.trim().length === 0) {
    throw new Error(
      "Malformed OpenAI response: missing choices[0].message.content",
    );
  }

  return content;
}
