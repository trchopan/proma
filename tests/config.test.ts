import { expect, test } from "bun:test";
import { mkdir, mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { loadProjectConfig, resolveDigestAllowedSources } from "$/config";

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
