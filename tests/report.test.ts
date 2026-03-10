import { expect, test } from "bun:test";
import { createBuiltInPromptRegistry } from "../src/prompting/registry";
import {
  generateReport,
  parseReportResponse,
  REPORT_RESPONSE_SCHEMA,
  renderReportMarkdown,
} from "../src/report";

test("parseReportResponse parses valid structured payload", () => {
  const report = parseReportResponse(
    JSON.stringify({
      title: "Weekly Project Report",
      executiveSummary: "Progress is on track.",
      updatedInformation: ["Completed integration tests"],
      resolutions: ["Resolved deployment blocker"],
      nextSteps: ["Prepare release checklist"],
    }),
  );

  expect(report).toEqual({
    title: "Weekly Project Report",
    executiveSummary: "Progress is on track.",
    updatedInformation: ["Completed integration tests"],
    resolutions: ["Resolved deployment blocker"],
    nextSteps: ["Prepare release checklist"],
  });
});

test("parseReportResponse rejects non-json payload", () => {
  expect(() => parseReportResponse("not-json")).toThrow(
    "Report response was not valid JSON",
  );
});

test("renderReportMarkdown includes required sections", () => {
  const markdown = renderReportMarkdown({
    title: "Daily Report",
    executiveSummary: "Summary",
    updatedInformation: ["Updated"],
    resolutions: [],
    nextSteps: ["Next"],
  });

  expect(markdown).toContain("# Daily Report");
  expect(markdown).toContain("## Executive Summary");
  expect(markdown).toContain("## Updated Information");
  expect(markdown).toContain("## Resolutions");
  expect(markdown).toContain("## Next Steps");
  expect(markdown).toContain("- None");
});

test("generateReport sends strict schema with context variables", async () => {
  let captured:
    | {
        responseFormat?: unknown;
        messages?: unknown;
      }
    | undefined;

  const result = await generateReport(
    {
      period: "weekly",
      inputs: [
        {
          path: "planning/release.md",
          category: "planning",
          topic: "Release",
          summary: "Summary",
          keyPoints: ["Point"],
          timeline: ["2026-03-09 - Update"],
          references: [],
        },
      ],
      baseReports: [
        {
          path: "reports/2026-03-01_weekly.md",
          period: "weekly",
          generatedAt: "2026-03-01T10:00:00.000Z",
          title: "Previous",
          body: "Old body",
        },
      ],
    },
    {
      model: "gpt-4o-mini",
      promptRegistry: createBuiltInPromptRegistry(),
    },
    async (options) => {
      captured = {
        responseFormat: options.responseFormat,
        messages: options.messages,
      };
      return JSON.stringify({
        title: "Weekly",
        executiveSummary: "Summary",
        updatedInformation: [],
        resolutions: [],
        nextSteps: [],
      });
    },
  );

  expect(result.title).toBe("Weekly");
  expect(captured?.responseFormat).toEqual({
    type: "json_schema",
    json_schema: {
      name: "project_report",
      strict: true,
      schema: REPORT_RESPONSE_SCHEMA,
    },
  });

  const promptText = ((captured?.messages as { content: string }[]) ?? [])
    .map((message) => message.content)
    .join("\n");
  expect(promptText).toContain("Create a weekly project report");
  expect(promptText).toContain("planning/release.md");
  expect(promptText).toContain("2026-03-01_weekly.md");
});
