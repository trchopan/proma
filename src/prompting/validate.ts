import type { ProcessingKind, PromptRegistry } from "./types";

const REQUIRED_KINDS: ProcessingKind[] = ["digest", "merge", "report"];

function sampleContext(kind: ProcessingKind): unknown {
  if (kind === "digest") {
    return {
      inputText: "sample",
      images: [],
      allowedSources: ["slack", "wiki", "git", "document"],
    };
  }

  if (kind === "merge") {
    return {
      item: {
        category: "planning",
        source: "slack",
        summary: "sample",
        keyPoints: [],
        timeline: [],
        references: [],
      },
      candidates: [],
    };
  }

  return {
    period: "weekly",
    inputs: [],
    baseReports: [],
  };
}

/**
 * Validates that a composed prompt registry satisfies required runtime
 * contracts before CLI command execution.
 *
 * This enforces that all required operations exist and that each operation
 * still returns Structured Outputs (`json_schema`) after plugin patches or
 * overrides.
 *
 * Throws a descriptive `Error` when any contract check fails.
 */
export function validatePromptRegistry(registry: PromptRegistry): void {
  for (const kind of REQUIRED_KINDS) {
    const operation = registry[kind];
    if (!operation || typeof operation !== "object") {
      throw new Error(`Prompt registry is missing required operation: ${kind}`);
    }

    if (operation.kind !== kind) {
      throw new Error(
        `Prompt registry operation '${kind}' has invalid kind field: ${operation.kind}`,
      );
    }

    if (typeof operation.buildPrompt !== "function") {
      throw new Error(
        `Prompt registry operation '${kind}' is missing buildPrompt function`,
      );
    }

    if (typeof operation.parseResponse !== "function") {
      throw new Error(
        `Prompt registry operation '${kind}' is missing parseResponse function`,
      );
    }

    const built = operation.buildPrompt(sampleContext(kind) as never);
    if (!built || typeof built !== "object") {
      throw new Error(
        `Prompt registry operation '${kind}' buildPrompt must return an object`,
      );
    }

    if (!Array.isArray(built.messages)) {
      throw new Error(
        `Prompt registry operation '${kind}' buildPrompt must return messages array`,
      );
    }

    if (!built.responseFormat || typeof built.responseFormat !== "object") {
      throw new Error(
        `Prompt registry operation '${kind}' buildPrompt must return responseFormat`,
      );
    }

    if (built.responseFormat.type !== "json_schema") {
      throw new Error(
        `Prompt registry operation '${kind}' must use json_schema response format`,
      );
    }

    const schema = built.responseFormat.json_schema;
    if (!schema || typeof schema !== "object") {
      throw new Error(
        `Prompt registry operation '${kind}' json_schema response format is invalid`,
      );
    }

    if (typeof schema.name !== "string" || schema.name.trim().length === 0) {
      throw new Error(
        `Prompt registry operation '${kind}' json_schema.name must be a non-empty string`,
      );
    }

    if (typeof schema.strict !== "boolean") {
      throw new Error(
        `Prompt registry operation '${kind}' json_schema.strict must be a boolean`,
      );
    }

    if (!schema.schema || typeof schema.schema !== "object") {
      throw new Error(
        `Prompt registry operation '${kind}' json_schema.schema must be an object`,
      );
    }
  }
}
