import { expect, test } from "bun:test";

import { executePromptOperation } from "$/core/prompting/execute";
import { createBuiltInPromptRegistry } from "$/core/prompting/registry";
import { validatePromptRegistry } from "$/core/prompting/validate";

test("validatePromptRegistry accepts built-in registry", () => {
  const registry = createBuiltInPromptRegistry();
  expect(() => validatePromptRegistry(registry)).not.toThrow();
});

test("executePromptOperation sends built response format and parses output", async () => {
  const registry = createBuiltInPromptRegistry();

  let capturedResponseFormat: unknown;
  const result = await executePromptOperation(
    registry,
    "report",
    {
      period: "weekly",
      inputs: [],
      baseReports: [],
    },
    {
      model: "gpt-4o-mini",
      chatCompletion: async (options) => {
        capturedResponseFormat = options.responseFormat;
        return JSON.stringify({
          title: "Weekly",
          executiveSummary: "Summary",
          updatedInformation: [],
          resolutions: [],
          nextSteps: [],
        });
      },
    },
  );

  expect(result.title).toBe("Weekly");
  expect(capturedResponseFormat).toEqual({
    type: "json_schema",
    json_schema: {
      name: "project_report",
      strict: true,
      schema: expect.any(Object),
    },
  });
});

test("validatePromptRegistry rejects missing json_schema metadata", () => {
  const registry = createBuiltInPromptRegistry();
  registry.report = {
    ...registry.report,
    buildPrompt: () => ({
      messages: [{ role: "system", content: "x" }],
      responseFormat: {
        type: "json_schema",
        json_schema: {
          name: "",
          strict: true,
          schema: { type: "object" },
        },
      },
    }),
  };

  expect(() => validatePromptRegistry(registry)).toThrow(
    "json_schema.name must be a non-empty string",
  );
});
