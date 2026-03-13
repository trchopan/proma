import { mkdir } from "node:fs/promises";
import path from "node:path";

import { slugifyTopic } from "../services/topic-merge";

export type ImportedFile = {
  absolutePath: string;
  relativePath: string;
};

type ResolveImportPathOptions = {
  projectRoot: string;
  server: string;
  tool: string;
  output?: string;
  now?: Date;
};

function formatDatePart(now: Date): string {
  return now.toISOString().slice(0, 10);
}

async function resolveDefaultOutputPath(
  options: ResolveImportPathOptions,
): Promise<string> {
  const importsDir = path.join(options.projectRoot, "imports");
  const datePart = formatDatePart(options.now ?? new Date());
  const baseName = `${datePart}_${slugifyTopic(options.server)}_${slugifyTopic(options.tool)}`;

  for (let index = 1; index < 10_000; index += 1) {
    const suffix = index === 1 ? "" : `_${index}`;
    const candidate = path.join(importsDir, `${baseName}${suffix}.md`);
    if (!(await Bun.file(candidate).exists())) {
      return candidate;
    }
  }

  throw new Error("Unable to allocate import output path");
}

export async function resolveImportOutputPath(
  options: ResolveImportPathOptions,
): Promise<string> {
  if (options.output) {
    return path.resolve(options.output);
  }

  return resolveDefaultOutputPath(options);
}

export async function writeImportedMarkdown(options: {
  projectRoot: string;
  server: string;
  tool: string;
  markdown: string;
  output?: string;
  now?: Date;
}): Promise<ImportedFile> {
  const absolutePath = await resolveImportOutputPath({
    projectRoot: options.projectRoot,
    server: options.server,
    tool: options.tool,
    output: options.output,
    now: options.now,
  });
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await Bun.write(absolutePath, options.markdown);

  return {
    absolutePath,
    relativePath: path.relative(options.projectRoot, absolutePath),
  };
}
