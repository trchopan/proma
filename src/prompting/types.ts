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

export type ProcessingKind = "digest" | "merge" | "report";

export type DigestOperationContext = {
  inputText: string;
  images: DigestInputImage[];
  allowedSources: readonly DigestSource[];
};

export type MergeOperationContext = {
  item: DigestItem;
  candidates: TopicRoutingCandidate[];
};

export type ReportOperationContext = {
  period: ReportPeriod;
  inputs: ReportInputContext[];
  baseReports: BaseReportContext[];
};

export type OperationContextMap = {
  digest: DigestOperationContext;
  merge: MergeOperationContext;
  report: ReportOperationContext;
};

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

export type PromptBuildResult = {
  messages: ChatCompletionOptions["messages"];
  responseFormat: ChatResponseFormat;
  temperature?: number;
};

export type OperationDefinition<K extends ProcessingKind> = {
  kind: K;
  version: string;
  buildPrompt: (context: OperationContextMap[K]) => PromptBuildResult;
  parseResponse: (
    raw: string,
    context: OperationContextMap[K],
  ) => OperationOutputMap[K];
};

export type PromptRegistry = {
  [K in ProcessingKind]: OperationDefinition<K>;
};
