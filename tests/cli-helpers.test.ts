import { expect, test } from "bun:test";

import { parseDigestCommandArgs, parseMergeCommandArgs } from "../src/cli/args";
import { renderDiffPreview } from "../src/cli/diff-preview";

test("cli args parser supports global defaults", () => {
  const digest = parseDigestCommandArgs([
    "--input",
    "notes.md",
    "--project",
    "acme",
  ]);
  const merge = parseMergeCommandArgs(["--project", "acme"]);

  expect(digest.model).toBe("gpt-5.2");
  expect(merge.model).toBe("gpt-5.2");
});

test("diff preview includes add and remove counters", () => {
  const preview = renderDiffPreview("a\nb", "a\nc");
  expect(preview).toContain("Changes: +1 -1");
  expect(preview).toContain("- b");
  expect(preview).toContain("+ c");
});
