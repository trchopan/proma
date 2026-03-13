import type { Logger } from "$/core/logging";
import type {
  OperationContextMap,
  OperationOutputMap,
  ProcessingKind,
  PromptRegistry,
} from "$/core/prompting/types";
import {
  type ChatCompletionOptions,
  createChatCompletion,
} from "$/integrations/ai/openai";

export type PromptExecutionOptions = {
  model: string;
  logger?: Logger;
  dryRun?: boolean;
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
    dryRun: options.dryRun,
    temperature: built.temperature ?? 0.2,
    messages: built.messages,
    responseFormat: built.responseFormat,
  });

  return operation.parseResponse(responseText, context);
}
