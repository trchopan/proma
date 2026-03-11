import type { ChatCompletionOptions } from "../ai/openai";
import { executePromptOperation } from "../prompting/execute";
import type {
  DigestGenerationInput,
  DigestGenerationOptions,
  DigestItem,
  DigestSource,
  MergeContentInput,
  MergeContentOptions,
  MergeContentResult,
  TopicRoutingCandidate,
  TopicRoutingOptions,
  TopicRoutingTarget,
} from "./types";
import { DIGEST_SOURCES } from "./types";

export async function generateDigestItems(
  input: DigestGenerationInput,
  options: DigestGenerationOptions & {
    allowedSources?: readonly DigestSource[];
  },
  chatCompletion?: (options: ChatCompletionOptions) => Promise<string>,
): Promise<DigestItem[]> {
  const inputText = typeof input === "string" ? input : input.text;
  const images = typeof input === "string" ? [] : (input.images ?? []);

  return executePromptOperation(
    options.promptRegistry,
    "digest",
    {
      inputText,
      images,
      allowedSources: options.allowedSources ?? DIGEST_SOURCES,
    },
    {
      model: options.model,
      logger: options.logger,
      dryRun: options.dryRun,
      chatCompletion,
    },
  );
}

export async function generateTopicTarget(
  item: DigestItem,
  candidates: TopicRoutingCandidate[],
  options: TopicRoutingOptions,
  chatCompletion?: (options: ChatCompletionOptions) => Promise<string>,
): Promise<TopicRoutingTarget> {
  return executePromptOperation(
    options.promptRegistry,
    "merge",
    {
      item,
      candidates,
    },
    {
      model: options.model,
      logger: options.logger,
      dryRun: options.dryRun,
      chatCompletion,
    },
  );
}

export async function generateMergeContent(
  input: MergeContentInput,
  options: MergeContentOptions,
  chatCompletion?: (options: ChatCompletionOptions) => Promise<string>,
): Promise<MergeContentResult> {
  return executePromptOperation(
    options.promptRegistry,
    "merge_content",
    input,
    {
      model: options.model,
      logger: options.logger,
      dryRun: options.dryRun,
      chatCompletion,
    },
  );
}
