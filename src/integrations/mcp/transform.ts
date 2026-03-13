import type { McpTool } from "$/integrations/mcp/client";

function stringifyJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return JSON.stringify(String(value));
  }
}

function extractTextContent(result: unknown): string | null {
  if (typeof result === "string") {
    return result;
  }

  if (typeof result !== "object" || result === null) {
    return null;
  }

  const maybeContent = (result as { content?: unknown }).content;
  if (!Array.isArray(maybeContent)) {
    return null;
  }

  const parts = maybeContent
    .map((entry) => {
      if (typeof entry !== "object" || entry === null) {
        return null;
      }

      const type = (entry as { type?: unknown }).type;
      const text = (entry as { text?: unknown }).text;
      if (type === "text" && typeof text === "string") {
        return text;
      }

      return null;
    })
    .filter((entry): entry is string => Boolean(entry));

  if (parts.length === 0) {
    return null;
  }

  return parts.join("\n\n");
}

export function renderActionList(options: {
  tools: McpTool[];
  server: string;
  verbose: boolean;
}): string {
  if (options.tools.length === 0) {
    return `No actions found for MCP server '${options.server}'.`;
  }

  const lines = [`Actions for MCP server '${options.server}':`];

  for (const tool of options.tools) {
    lines.push(
      `- ${tool.name}${tool.description ? `: ${tool.description}` : ""}`,
    );
    if (options.verbose && typeof tool.inputSchema !== "undefined") {
      lines.push("  input schema:");
      lines.push(
        ...stringifyJson(tool.inputSchema)
          .split("\n")
          .map((line) => `    ${line}`),
      );
    }
  }

  return lines.join("\n");
}

export function renderImportedMarkdown(options: {
  server: string;
  tool: string;
  args: Record<string, unknown>;
  result: unknown;
  generatedAt?: Date;
}): string {
  const generatedAt = (options.generatedAt ?? new Date()).toISOString();
  const textContent = extractTextContent(options.result);

  const body = [
    "---",
    `server: ${options.server}`,
    `tool: ${options.tool}`,
    `imported_at: ${generatedAt}`,
    "---",
    "",
    `# Imported from ${options.server}/${options.tool}`,
    "",
    "## Request Args",
    "```json",
    stringifyJson(options.args),
    "```",
    "",
    "## Result",
  ];

  if (textContent) {
    body.push(textContent);
  } else {
    body.push("```json");
    body.push(stringifyJson(options.result));
    body.push("```");
  }

  return body.join("\n");
}
