import { spawn } from "node:child_process";

import type { McpTool } from "$/integrations/mcp/client";

const DEFAULT_GH_TIMEOUT_MS = 20_000;

type GithubCallOptions = {
  tool: string;
  args: Record<string, unknown>;
  host?: string;
  timeoutMs?: number;
};

type GithubToolSpec = {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    required: string[];
    properties: Record<string, { type: string; description: string }>;
  };
  buildRequest: (args: Record<string, unknown>) => {
    endpoint: string;
    query: Record<string, string>;
  };
};

const GITHUB_LIST_STATES = new Set(["open", "closed", "all"]);

const GITHUB_TOOL_SPECS: readonly GithubToolSpec[] = [
  {
    name: "issue_get",
    description: "Get one GitHub issue by number",
    inputSchema: {
      type: "object",
      required: ["owner", "repo", "number"],
      properties: {
        owner: { type: "string", description: "Repository owner" },
        repo: { type: "string", description: "Repository name" },
        number: { type: "number", description: "Issue number" },
      },
    },
    buildRequest: (args) => {
      const owner = requiredString(args, "owner");
      const repo = requiredString(args, "repo");
      const number = requiredInteger(args, "number");
      return {
        endpoint: `/repos/${owner}/${repo}/issues/${number}`,
        query: {},
      };
    },
  },
  {
    name: "issues_list",
    description: "List GitHub issues for a repository",
    inputSchema: {
      type: "object",
      required: ["owner", "repo"],
      properties: {
        owner: { type: "string", description: "Repository owner" },
        repo: { type: "string", description: "Repository name" },
        state: {
          type: "string",
          description: "Issue state: open, closed, or all",
        },
        per_page: { type: "number", description: "Results per page" },
        page: { type: "number", description: "Page number" },
      },
    },
    buildRequest: (args) => {
      const owner = requiredString(args, "owner");
      const repo = requiredString(args, "repo");

      return {
        endpoint: `/repos/${owner}/${repo}/issues`,
        query: optionalQuery(args, ["state", "per_page", "page"]),
      };
    },
  },
  {
    name: "pr_get",
    description: "Get one GitHub pull request by number",
    inputSchema: {
      type: "object",
      required: ["owner", "repo", "number"],
      properties: {
        owner: { type: "string", description: "Repository owner" },
        repo: { type: "string", description: "Repository name" },
        number: { type: "number", description: "Pull request number" },
      },
    },
    buildRequest: (args) => {
      const owner = requiredString(args, "owner");
      const repo = requiredString(args, "repo");
      const number = requiredInteger(args, "number");
      return {
        endpoint: `/repos/${owner}/${repo}/pulls/${number}`,
        query: {},
      };
    },
  },
  {
    name: "prs_list",
    description:
      "List GitHub pull requests for a repository (supports optional author filter)",
    inputSchema: {
      type: "object",
      required: ["owner", "repo"],
      properties: {
        owner: { type: "string", description: "Repository owner" },
        repo: { type: "string", description: "Repository name" },
        state: { type: "string", description: "PR state: open, closed, all" },
        author: {
          type: "string",
          description:
            "Optional author login; when set, uses search endpoint for filtering",
        },
        per_page: { type: "number", description: "Results per page" },
        page: { type: "number", description: "Page number" },
      },
    },
    buildRequest: (args) => {
      const owner = requiredString(args, "owner");
      const repo = requiredString(args, "repo");
      const state = optionalState(args);
      const author = optionalString(args, "author");

      if (author) {
        const query = optionalQuery(args, ["per_page", "page"]);
        const searchTerms = [
          `repo:${owner}/${repo}`,
          "is:pr",
          `author:${author}`,
        ];

        if (state === "open" || state === "closed") {
          searchTerms.push(`is:${state}`);
        }

        query.q = searchTerms.join(" ");
        return {
          endpoint: "/search/issues",
          query,
        };
      }

      return {
        endpoint: `/repos/${owner}/${repo}/pulls`,
        query: optionalQuery(args, ["state", "per_page", "page"]),
      };
    },
  },
  {
    name: "issue_comments",
    description: "List comments for a GitHub issue",
    inputSchema: {
      type: "object",
      required: ["owner", "repo", "number"],
      properties: {
        owner: { type: "string", description: "Repository owner" },
        repo: { type: "string", description: "Repository name" },
        number: { type: "number", description: "Issue number" },
        per_page: { type: "number", description: "Results per page" },
        page: { type: "number", description: "Page number" },
      },
    },
    buildRequest: (args) => {
      const owner = requiredString(args, "owner");
      const repo = requiredString(args, "repo");
      const number = requiredInteger(args, "number");

      return {
        endpoint: `/repos/${owner}/${repo}/issues/${number}/comments`,
        query: optionalQuery(args, ["per_page", "page"]),
      };
    },
  },
];

function requiredString(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Invalid --args: '${key}' must be a non-empty string`);
  }

  return value.trim();
}

function requiredInteger(args: Record<string, unknown>, key: string): number {
  const value = args[key];

  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }

  if (typeof value === "string" && /^\d+$/.test(value)) {
    return Number.parseInt(value, 10);
  }

  throw new Error(`Invalid --args: '${key}' must be a positive integer`);
}

function optionalString(
  args: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = args[key];
  if (typeof value === "undefined") {
    return undefined;
  }

  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Invalid --args: '${key}' must be a non-empty string`);
  }

  return value.trim();
}

function optionalState(args: Record<string, unknown>): string | undefined {
  const state = optionalString(args, "state");
  if (!state) {
    return undefined;
  }

  if (!GITHUB_LIST_STATES.has(state)) {
    throw new Error(
      "Invalid --args: 'state' must be one of: open, closed, all",
    );
  }

  return state;
}

export function buildGhApiCommandArgs(options: {
  endpoint: string;
  query: Record<string, string>;
  host?: string;
}): string[] {
  const args = ["api", options.endpoint, "--method", "GET"];
  if (options.host) {
    args.push("--hostname", options.host);
  }
  for (const [key, value] of Object.entries(options.query)) {
    args.push("-f", `${key}=${value}`);
  }

  return args;
}

function optionalQuery(
  args: Record<string, unknown>,
  keys: readonly string[],
): Record<string, string> {
  const result: Record<string, string> = {};

  for (const key of keys) {
    const value = args[key];
    if (typeof value === "undefined") {
      continue;
    }

    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed.length === 0) {
        throw new Error(`Invalid --args: '${key}' must not be empty`);
      }
      result[key] = trimmed;
      continue;
    }

    if (typeof value === "number" && Number.isFinite(value)) {
      result[key] = String(value);
      continue;
    }

    throw new Error(`Invalid --args: '${key}' must be a string or number`);
  }

  return result;
}

function getToolSpec(tool: string): GithubToolSpec {
  const spec = GITHUB_TOOL_SPECS.find((entry) => entry.name === tool);
  if (!spec) {
    throw new Error(`Unknown GitHub import tool: ${tool}`);
  }
  return spec;
}

async function runGhApi(options: {
  endpoint: string;
  query: Record<string, string>;
  host?: string;
  timeoutMs: number;
}): Promise<unknown> {
  const args = buildGhApiCommandArgs(options);

  const child = spawn("gh", args, {
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";

  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const settleResolve = () => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve();
    };
    const settleReject = (error: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      reject(error);
    };

    const timer = setTimeout(() => {
      child.kill();
      settleReject(
        new Error(
          `GitHub import request timed out after ${options.timeoutMs}ms`,
        ),
      );
    }, options.timeoutMs);

    child.once("error", (error) => {
      const message = error instanceof Error ? error.message : "Unknown error";
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        (error as { code?: unknown }).code === "ENOENT"
      ) {
        settleReject(
          new Error(
            "GitHub CLI ('gh') is not installed or not available in PATH",
          ),
        );
        return;
      }

      settleReject(new Error(`Failed to run GitHub CLI ('gh'): ${message}`));
    });

    child.once("close", (code, signal) => {
      if (code !== 0) {
        const stderrText = stderr.trim();
        const reason = stderrText ? `; stderr: ${stderrText}` : "";
        settleReject(
          new Error(
            `GitHub CLI request failed (code=${code ?? "null"}, signal=${signal ?? "null"})${reason}`,
          ),
        );
        return;
      }
      settleResolve();
    });
  });

  const text = stdout.trim();
  if (text.length === 0) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error("GitHub CLI returned non-JSON output");
  }
}

export function listGithubTools(): McpTool[] {
  return GITHUB_TOOL_SPECS.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
  }));
}

export async function callGithubTool(
  options: GithubCallOptions,
): Promise<unknown> {
  const spec = getToolSpec(options.tool);
  const { endpoint, query } = spec.buildRequest(options.args);
  const result = await runGhApi({
    endpoint,
    query,
    host: options.host,
    timeoutMs: options.timeoutMs ?? DEFAULT_GH_TIMEOUT_MS,
  });

  return {
    provider: "github",
    host: options.host,
    tool: options.tool,
    endpoint,
    query,
    result,
  };
}
