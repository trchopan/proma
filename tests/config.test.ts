import { expect, test } from "bun:test";
import { mkdir, mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  loadProjectConfig,
  resolveDigestAllowedSources,
  resolveMcpServer,
} from "$/config";

test("resolveDigestAllowedSources returns defaults when config is missing", () => {
  const allowedSources = resolveDigestAllowedSources({});

  expect(allowedSources).toEqual(["document", "git", "slack", "wiki"]);
});

test("resolveDigestAllowedSources unions defaults and custom values", () => {
  const allowedSources = resolveDigestAllowedSources({
    digest: {
      allowedSources: ["jira", "notion", "JIRA", "  "],
    },
  });

  expect(allowedSources).toEqual([
    "document",
    "git",
    "jira",
    "notion",
    "slack",
    "wiki",
  ]);
});

test("loadProjectConfig prefers ts over mjs and js", async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "proma-config-test-"));
  const projectRoot = path.join(tmpDir, "project");
  await mkdir(projectRoot, { recursive: true });

  await Bun.write(
    path.join(projectRoot, "proma.config.js"),
    'export default { digest: { allowedSources: ["js-source"] } };',
  );
  await Bun.write(
    path.join(projectRoot, "proma.config.mjs"),
    'export default { digest: { allowedSources: ["mjs-source"] } };',
  );
  await Bun.write(
    path.join(projectRoot, "proma.config.ts"),
    'export default { digest: { allowedSources: ["ts-source"] } };',
  );

  const config = await loadProjectConfig(projectRoot);

  expect(config.digest?.allowedSources).toEqual(["ts-source"]);
});

test("loadProjectConfig accepts valid mcp local server definitions", async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "proma-config-test-"));
  const projectRoot = path.join(tmpDir, "project");
  await mkdir(projectRoot, { recursive: true });

  await Bun.write(
    path.join(projectRoot, "proma.config.ts"),
    [
      "export default {",
      "  mcp: {",
      "    slack: {",
      '      type: "local",',
      '      command: ["bun", "./scripts/slack-mcp.ts"],',
      "    },",
      "  },",
      "};",
    ].join("\n"),
  );

  const config = await loadProjectConfig(projectRoot);

  expect(config.mcp).toEqual({
    slack: {
      type: "local",
      command: ["bun", "./scripts/slack-mcp.ts"],
    },
  });
});

test("loadProjectConfig rejects invalid mcp command shape", async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "proma-config-test-"));
  const projectRoot = path.join(tmpDir, "project");
  await mkdir(projectRoot, { recursive: true });

  await Bun.write(
    path.join(projectRoot, "proma.config.ts"),
    [
      "export default {",
      "  mcp: {",
      "    slack: {",
      '      type: "local",',
      "      command: [],",
      "    },",
      "  },",
      "};",
    ].join("\n"),
  );

  await expect(loadProjectConfig(projectRoot)).rejects.toThrow(
    "mcp.slack.command must be a non-empty string array",
  );
});

test("resolveMcpServer resolves known server and rejects unknown", () => {
  const config = {
    mcp: {
      slack: {
        type: "local" as const,
        command: ["bun", "./scripts/slack-mcp.ts"],
      },
    },
  };

  expect(resolveMcpServer(config, "slack")).toEqual({
    type: "local",
    command: ["bun", "./scripts/slack-mcp.ts"],
  });

  expect(() => resolveMcpServer(config, "unknown")).toThrow(
    "Unknown MCP server: unknown",
  );
});
