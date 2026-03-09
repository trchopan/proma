import { type ChatCompletionOptions, createChatCompletion } from "./ai/openai";
import type { Logger } from "./logging";
import {
  type PromptTemplateSections,
  renderPromptTemplate,
} from "./prompt-template";

export const REPORT_PERIODS = [
  "daily",
  "weekly",
  "bi-weekly",
  "monthly",
] as const;

export type ReportPeriod = (typeof REPORT_PERIODS)[number];

export type ReportInputContext = {
  path: string;
  category: string;
  topic: string;
  summary: string;
  keyPoints: string[];
  timeline: string[];
  references: string[];
};

export type BaseReportContext = {
  path: string;
  period: string;
  generatedAt: string;
  title: string;
  body: string;
};

export type ReportContextPayload = {
  period: ReportPeriod;
  inputs: ReportInputContext[];
  baseReports: BaseReportContext[];
};

export type ReportGeneration = {
  title: string;
  executiveSummary: string;
  updatedInformation: string[];
  resolutions: string[];
  nextSteps: string[];
};

export type ReportGenerationOptions = {
  model: string;
  logger?: Logger;
  promptTemplate?: PromptTemplateSections;
};

type ChatCompletionFn = (options: ChatCompletionOptions) => Promise<string>;

export const REPORT_RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    title: { type: "string" },
    executiveSummary: { type: "string" },
    updatedInformation: {
      type: "array",
      items: { type: "string" },
    },
    resolutions: {
      type: "array",
      items: { type: "string" },
    },
    nextSteps: {
      type: "array",
      items: { type: "string" },
    },
  },
  required: [
    "title",
    "executiveSummary",
    "updatedInformation",
    "resolutions",
    "nextSteps",
  ],
} as const;

function normalizeString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Report response contained empty ${field}`);
  }
  return value.trim();
}

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

export function parseReportResponse(content: string): ReportGeneration {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error("Report response was not valid JSON");
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error("Report response must be a JSON object");
  }

  const value = parsed as Record<string, unknown>;
  return {
    title: normalizeString(value.title, "title"),
    executiveSummary: normalizeString(
      value.executiveSummary,
      "executiveSummary",
    ),
    updatedInformation: normalizeStringList(value.updatedInformation),
    resolutions: normalizeStringList(value.resolutions),
    nextSteps: normalizeStringList(value.nextSteps),
  };
}

function bulletList(values: string[]): string {
  if (values.length === 0) {
    return "- None";
  }
  return values.map((value) => `- ${value}`).join("\n");
}

export function renderReportMarkdown(report: ReportGeneration): string {
  return [
    `# ${report.title}`,
    "",
    "## Executive Summary",
    report.executiveSummary,
    "",
    "## Updated Information",
    bulletList(report.updatedInformation),
    "",
    "## Resolutions",
    bulletList(report.resolutions),
    "",
    "## Next Steps",
    bulletList(report.nextSteps),
    "",
  ].join("\n");
}

export async function generateReport(
  context: ReportContextPayload,
  options: ReportGenerationOptions,
  chatCompletion: ChatCompletionFn = createChatCompletion,
): Promise<ReportGeneration> {
  const variables = {
    PERIOD: context.period,
    INPUT_CONTEXT_JSON: JSON.stringify(context.inputs, null, 2),
    BASE_REPORT_CONTEXT_JSON: JSON.stringify(context.baseReports, null, 2),
  };

  const systemPrompt = renderPromptTemplate(
    options.promptTemplate?.system ??
      "You generate concise project reports and must satisfy the provided response schema.",
    variables,
    "report system prompt",
  );

  const userPrompt = renderPromptTemplate(
    options.promptTemplate?.user ??
      [
        "Create a {{PERIOD}} project report from current topic context and prior reports.",
        "Continue narrative from base reports where applicable.",
        "Call out updates and what has been resolved since prior reports.",
        "Input context:",
        "{{INPUT_CONTEXT_JSON}}",
        "Base report context:",
        "{{BASE_REPORT_CONTEXT_JSON}}",
      ].join("\n\n"),
    variables,
    "report user prompt",
  );

  const responseText = await chatCompletion({
    model: options.model,
    logger: options.logger,
    temperature: 0.2,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    responseFormat: {
      type: "json_schema",
      json_schema: {
        name: "project_report",
        strict: true,
        schema: REPORT_RESPONSE_SCHEMA,
      },
    },
  });

  return parseReportResponse(responseText);
}
