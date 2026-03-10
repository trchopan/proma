import { expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { executePromptOperation } from "../src/prompting/execute";
import { loadPromptRegistry } from "../src/prompting/load";
import { createBuiltInPromptRegistry } from "../src/prompting/registry";
import { validatePromptRegistry } from "../src/prompting/validate";

test("validatePromptRegistry accepts built-in registry", () => {
  const registry = createBuiltInPromptRegistry();
  expect(() => validatePromptRegistry(registry)).not.toThrow();
});

test("loadPromptRegistry returns built-ins when config is missing", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "proma-registry-"));
  const registry = await loadPromptRegistry(dir);

  expect(registry.digest.kind).toBe("digest");
  expect(registry.merge.kind).toBe("merge");
  expect(registry.report.kind).toBe("report");
});

test("loadPromptRegistry applies plugin patches from proma.config.ts", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "proma-plugin-"));
  const configPath = path.join(dir, "proma.config.ts");

  await Bun.write(
    configPath,
    [
      "export default {",
      "  plugins: [",
      "    {",
      '      name: "custom-digest-system",',
      "      setup(api) {",
      '        api.patchOperation("digest", (current) => ({',
      "          ...current,",
      "          buildPrompt(context) {",
      "            const built = current.buildPrompt(context);",
      "            return {",
      "              ...built,",
      "              messages: built.messages.map((message) =>",
      '                message.role === "system"',
      '                  ? { ...message, content: String(message.content) + "\\nCUSTOM_RULE=1" }',
      "                  : message,",
      "              ),",
      "            };",
      "          },",
      "        }));",
      "      },",
      "    },",
      "  ],",
      "};",
    ].join("\n"),
  );

  const registry = await loadPromptRegistry(dir);
  const built = registry.digest.buildPrompt({
    inputText: "hello",
    images: [],
    allowedSources: ["slack", "wiki", "git", "figma", "file"],
  });

  const system = built.messages.find((message) => message.role === "system");
  expect(typeof system?.content).toBe("string");
  expect(system?.content).toContain("CUSTOM_RULE=1");
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

test("validatePromptRegistry rejects non-json-schema operations", () => {
  const registry = createBuiltInPromptRegistry();
  registry.report = {
    ...registry.report,
    buildPrompt: () => ({
      messages: [{ role: "system", content: "x" }],
      responseFormat: { type: "json_object" },
    }),
  };

  expect(() => validatePromptRegistry(registry)).toThrow(
    "must use json_schema response format",
  );
});
