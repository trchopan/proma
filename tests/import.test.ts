import { expect, test } from "bun:test";
import { mkdir, mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { renderActionList, renderImportedMarkdown } from "$/import/transform";
import {
  resolveImportOutputPath,
  writeImportedMarkdown,
} from "$/storage/import-files";

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

  expect(markdown).toContain("source: mcp");
  expect(markdown).toContain("server: slack");
  expect(markdown).toContain("tool: fetch_thread");
  expect(markdown).toContain("imported_at: 2026-03-12T10:00:00.000Z");
  expect(markdown).toContain("## Request Args");
  expect(markdown).toContain("Thread title");
  expect(markdown).toContain("- item 1");
});

test("resolveImportOutputPath allocates deterministic default filenames", async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "proma-import-path-"));
  const projectRoot = path.join(tmpDir, "apollo");
  await mkdir(path.join(projectRoot, "imports"), { recursive: true });

  const firstPath = await resolveImportOutputPath({
    projectRoot,
    server: "slack",
    tool: "fetch_thread",
    now: new Date("2026-03-12T10:00:00.000Z"),
  });
  expect(firstPath).toBe(
    path.join(projectRoot, "imports", "2026-03-12_slack_fetch-thread.md"),
  );

  await Bun.write(firstPath, "existing");

  const secondPath = await resolveImportOutputPath({
    projectRoot,
    server: "slack",
    tool: "fetch_thread",
    now: new Date("2026-03-12T10:00:00.000Z"),
  });

  expect(secondPath).toBe(
    path.join(projectRoot, "imports", "2026-03-12_slack_fetch-thread_2.md"),
  );
});

test("writeImportedMarkdown writes to explicit output path", async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "proma-import-write-"));
  const projectRoot = path.join(tmpDir, "apollo");
  await mkdir(projectRoot, { recursive: true });

  const output = path.join(projectRoot, "custom", "thread.md");
  const written = await writeImportedMarkdown({
    projectRoot,
    server: "slack",
    tool: "fetch_thread",
    output,
    markdown: "# Imported",
  });

  expect(written.absolutePath).toBe(output);
  expect(written.relativePath).toBe(path.join("custom", "thread.md"));
  expect(await Bun.file(output).text()).toBe("# Imported");
});
