import { expect, test } from "bun:test";
import { mkdir, mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  buildGhApiCommandArgs,
  callGithubTool,
  listGithubTools,
} from "$/integrations/github/client";

import {
  renderActionList,
  renderImportedMarkdown,
} from "$/integrations/mcp/transform";
import { writeImportedMarkdown } from "$/storage/import/import-files";

test("renderActionList renders concise action output", () => {
  const output = renderActionList({
    server: "slack",
    verbose: false,
    tools: [
      {
        name: "fetch_thread",
        description: "Fetch thread by channel and ts",
        inputSchema: {
          type: "object",
          properties: {
            channel: { type: "string" },
          },
        },
      },
    ],
  });

  expect(output).toContain("Actions for MCP server 'slack':");
  expect(output).toContain("- fetch_thread: Fetch thread by channel and ts");
  expect(output).not.toContain("input schema");
});

test("renderActionList includes input schema when verbose", () => {
  const output = renderActionList({
    server: "slack",
    verbose: true,
    tools: [
      {
        name: "fetch_thread",
        inputSchema: {
          type: "object",
          required: ["channel"],
        },
      },
    ],
  });

  expect(output).toContain("- fetch_thread");
  expect(output).toContain("input schema:");
  expect(output).toContain('"required": [');
});

test("renderImportedMarkdown prefers text content when available", () => {
  const markdown = renderImportedMarkdown({
    server: "slack",
    tool: "fetch_thread",
    args: { channel: "C123" },
    result: {
      content: [
        { type: "text", text: "Thread title" },
        { type: "text", text: "- item 1" },
      ],
    },
    generatedAt: new Date("2026-03-12T10:00:00.000Z"),
  });

  expect(markdown).toContain("server: slack");
  expect(markdown).toContain("tool: fetch_thread");
  expect(markdown).toContain("imported_at: 2026-03-12T10:00:00.000Z");
  expect(markdown).toContain("## Request Args");
  expect(markdown).toContain("Thread title");
  expect(markdown).toContain("- item 1");
});

test("writeImportedMarkdown writes to explicit output path", async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "proma-import-write-"));
  await mkdir(tmpDir, { recursive: true });

  const output = path.join(tmpDir, "custom", "thread.md");
  const written = await writeImportedMarkdown({
    output,
    markdown: "# Imported",
  });

  expect(written.absolutePath).toBe(output);
  expect(written.relativePath).toBe(output);
  expect(await Bun.file(output).text()).toBe("# Imported");
});

test("listGithubTools exposes issue and pull request actions", () => {
  const tools = listGithubTools();

  expect(tools.map((tool) => tool.name)).toEqual(
    expect.arrayContaining([
      "issue_get",
      "issues_list",
      "pr_get",
      "prs_list",
      "issue_comments",
    ]),
  );
});

test("callGithubTool rejects unknown tool names", async () => {
  await expect(
    callGithubTool({
      tool: "unknown_tool",
      args: {},
    }),
  ).rejects.toThrow("Unknown GitHub import tool");
});

test("callGithubTool validates required args before running gh", async () => {
  await expect(
    callGithubTool({
      tool: "pr_get",
      args: {
        owner: "acme",
        repo: "platform",
      },
    }),
  ).rejects.toThrow("'number' must be a positive integer");
});

test("buildGhApiCommandArgs always forces GET and supports host", () => {
  const args = buildGhApiCommandArgs({
    endpoint: "/repos/acme/project-orion-web/pulls",
    host: "git.linecorp.com",
    query: {
      state: "all",
      per_page: "10",
      page: "1",
    },
  });

  expect(args).toEqual([
    "api",
    "/repos/acme/project-orion-web/pulls",
    "--method",
    "GET",
    "--hostname",
    "git.linecorp.com",
    "-f",
    "state=all",
    "-f",
    "per_page=10",
    "-f",
    "page=1",
  ]);
});

test("callGithubTool validates state enum for list tools", async () => {
  await expect(
    callGithubTool({
      tool: "prs_list",
      args: {
        owner: "acme",
        repo: "project-orion-web",
        state: "invalid",
      },
    }),
  ).rejects.toThrow("'state' must be one of: open, closed, all");
});
