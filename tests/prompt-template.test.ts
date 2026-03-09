import { expect, test } from "bun:test";

import {
  parsePromptTemplateMarkdown,
  renderPromptTemplate,
} from "../src/prompt-template";

test("parsePromptTemplateMarkdown extracts system and user sections", () => {
  const template = [
    "# {{SYSTEM}}",
    "System instruction",
    "",
    "# {{USER}}",
    "Hello {{NAME}}",
  ].join("\n");

  const parsed = parsePromptTemplateMarkdown(template, "sample.md");

  expect(parsed).toEqual({
    system: "System instruction",
    user: "Hello {{NAME}}",
  });
});

test("parsePromptTemplateMarkdown rejects missing required sections", () => {
  const template = ["# {{SYSTEM}}", "Only system"].join("\n");

  expect(() => parsePromptTemplateMarkdown(template, "sample.md")).toThrow(
    "missing required section heading",
  );
});

test("parsePromptTemplateMarkdown rejects duplicate section headings", () => {
  const template = [
    "# {{SYSTEM}}",
    "one",
    "# {{SYSTEM}}",
    "two",
    "# {{USER}}",
    "ok",
  ].join("\n");

  expect(() => parsePromptTemplateMarkdown(template, "sample.md")).toThrow(
    "duplicate section heading",
  );
});

test("renderPromptTemplate replaces variables", () => {
  const rendered = renderPromptTemplate("Hello {{NAME}}", { NAME: "team" });
  expect(rendered).toBe("Hello team");
});

test("renderPromptTemplate rejects unresolved variables", () => {
  expect(() => renderPromptTemplate("Hello {{NAME}}", {}, "sample.md")).toThrow(
    "unresolved variable",
  );
});
