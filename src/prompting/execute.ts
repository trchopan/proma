import { type ChatCompletionOptions, createChatCompletion } from "../ai/openai";
import type { Logger } from "../logging";
import type {
  OperationContextMap,
  OperationOutputMap,
  ProcessingKind,
  PromptRegistry,
} from "./types";

export type PromptExecutionOptions = {
  model: string;
  logger?: Logger;
  chatCompletion?: (options: ChatCompletionOptions) => Promise<string>;
};

export async function executePromptOperation<K extends ProcessingKind>(
  registry: PromptRegistry,
  kind: K,
  context: OperationContextMap[K],
  options: PromptExecutionOptions,
): Promise<OperationOutputMap[K]> {
  const operation = registry[kind];
  const built = operation.buildPrompt(context);
  const completion = options.chatCompletion ?? createChatCompletion;

  const responseText = await completion({
    model: options.model,
    logger: options.logger,
    temperature: built.temperature ?? 0.2,
    messages: built.messages,
    responseFormat: built.responseFormat,
  });

  return operation.parseResponse(responseText, context);
}
