import { mkdir, readdir } from "node:fs/promises";
import path from "node:path";

import {
  type DigestCategory,
  type DigestItem,
  renderDigestMarkdown,
} from "./digest";

export type WriteDigestItemsOptions = {
  projectRoot: string;
  items: DigestItem[];
  now?: Date;
};

function toDateString(now: Date): string {
  return now.toISOString().slice(0, 10);
}

function parseIndex(fileName: string, datePrefix: string): number | null {
  const matcher = new RegExp(`^${datePrefix}_(\\d+)\\.md$`);
  const match = fileName.match(matcher);
  if (!match?.[1]) {
    return null;
  }

  const parsed = Number.parseInt(match[1], 10);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  return parsed;
}

export async function allocateNextIndex(
  directoryPath: string,
  datePrefix: string,
): Promise<number> {
  let files: string[] = [];

  try {
    files = await readdir(directoryPath);
  } catch {
    return 1;
  }

  let maxIndex = 0;
  for (const fileName of files) {
    const index = parseIndex(fileName, datePrefix);
    if (index && index > maxIndex) {
      maxIndex = index;
    }
  }

  return maxIndex + 1;
}

function buildRelativePath(
  category: DigestCategory,
  datePrefix: string,
  index: number,
): string {
  return path.join(category, `${datePrefix}_${index}.md`);
}

export async function writeDigestItems(
  options: WriteDigestItemsOptions,
): Promise<string[]> {
  const projectRoot = options.projectRoot;
  const datePrefix = toDateString(options.now ?? new Date());
  const nextByCategory = new Map<DigestCategory, number>();
  const writtenFiles: string[] = [];

  for (const item of options.items) {
    const categoryDir = path.join(projectRoot, item.category);

    await mkdir(categoryDir, { recursive: true });

    const currentNext = nextByCategory.get(item.category);
    const index =
      currentNext ?? (await allocateNextIndex(categoryDir, datePrefix));

    const relativePath = buildRelativePath(item.category, datePrefix, index);
    const absolutePath = path.join(projectRoot, relativePath);
    const markdown = renderDigestMarkdown(item);

    await Bun.write(absolutePath, markdown);

    writtenFiles.push(absolutePath);
    nextByCategory.set(item.category, index + 1);
  }

  return writtenFiles;
}
