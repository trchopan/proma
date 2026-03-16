import { mkdir } from "node:fs/promises";
import path from "node:path";

export type ImportedFile = {
  absolutePath: string;
  relativePath: string;
};

export async function writeImportedMarkdown(options: {
  output: string;
  markdown: string;
}): Promise<ImportedFile> {
  const absolutePath = path.resolve(options.output);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await Bun.write(absolutePath, options.markdown);

  return {
    absolutePath,
    relativePath: options.output,
  };
}
