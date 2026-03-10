import type { ChatCompletionOptions, ChatResponseFormat } from "../ai/openai";
import type {
  DigestInputImage,
  DigestItem,
  DigestSource,
  TopicRoutingCandidate,
  TopicRoutingTarget,
} from "../digest";
import type {
  BaseReportContext,
  ReportInputContext,
  ReportPeriod,
} from "../report";

/** Supported prompt-processing operation keys. */
export type ProcessingKind = "digest" | "merge" | "report";

/** Runtime input required to build a `digest` prompt. */
export type DigestOperationContext = {
  inputText: string;
  images: DigestInputImage[];
  allowedSources: readonly DigestSource[];
};

/** Runtime input required to build a `merge` prompt. */
export type MergeOperationContext = {
  item: DigestItem;
  candidates: TopicRoutingCandidate[];
};

/** Runtime input required to build a `report` prompt. */
export type ReportOperationContext = {
  period: ReportPeriod;
  inputs: ReportInputContext[];
  baseReports: BaseReportContext[];
};

/** Maps operation kind to its prompt-build input context. */
export type OperationContextMap = {
  digest: DigestOperationContext;
  merge: MergeOperationContext;
  report: ReportOperationContext;
};

/** Maps operation kind to its parsed model output shape. */
export type OperationOutputMap = {
  digest: DigestItem[];
  merge: TopicRoutingTarget[];
  report: {
    title: string;
    executiveSummary: string;
    updatedInformation: string[];
    resolutions: string[];
    nextSteps: string[];
  };
};

/** Canonical return value from each operation's `buildPrompt` function. */
export type PromptBuildResult = {
  messages: ChatCompletionOptions["messages"];
  responseFormat: ChatResponseFormat;
  temperature?: number;
};

/**
 * Full definition for one prompt operation.
 *
 * Plugin overrides and patches must preserve this contract so validation can
 * confirm registry correctness before commands run.
 */
export type OperationDefinition<K extends ProcessingKind> = {
  kind: K;
  version: string;
  buildPrompt: (context: OperationContextMap[K]) => PromptBuildResult;
  parseResponse: (
    raw: string,
    context: OperationContextMap[K],
  ) => OperationOutputMap[K];
};

/**
 * Registry of all required prompt operations.
 *
 * Every kind (`digest`, `merge`, `report`) must exist and remain valid after
 * plugin composition.
 */
export type PromptRegistry = {
  [K in ProcessingKind]: OperationDefinition<K>;
};
