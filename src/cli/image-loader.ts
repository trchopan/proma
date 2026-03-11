import path from "node:path";

import type { DigestInputImage } from "../digest/types";
import type { Logger } from "../logging";

const MARKDOWN_IMAGE_REGEX = /!\[[^\]]*\]\(([^)]+)\)/g;

const LOCAL_IMAGE_MIME_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

function parseImageTarget(rawTarget: string): string | null {
  const trimmed = rawTarget.trim();
  if (trimmed.length === 0) {
    return null;
  }

  const unwrapped =
    trimmed.startsWith("<") && trimmed.endsWith(">")
      ? trimmed.slice(1, -1).trim()
      : trimmed;

  if (unwrapped.length === 0) {
    return null;
  }

  const match = /^(\S+)/.exec(unwrapped);
  return match?.[1] ?? null;
}

function extractMarkdownImageTargets(markdown: string): string[] {
  const targets: string[] = [];
  const seen = new Set<string>();

  for (const match of markdown.matchAll(MARKDOWN_IMAGE_REGEX)) {
    const rawTarget = match[1];
    if (!rawTarget) {
      continue;
    }

    const parsedTarget = parseImageTarget(rawTarget);
    if (!parsedTarget || seen.has(parsedTarget)) {
      continue;
    }

    seen.add(parsedTarget);
    targets.push(parsedTarget);
  }

  return targets;
}

function isRemoteImage(target: string): boolean {
  return /^https?:\/\//i.test(target) || /^data:/i.test(target);
}

function resolveLocalImagePath(inputPath: string, target: string): string {
  if (path.isAbsolute(target)) {
    return target;
  }

  return path.resolve(path.dirname(inputPath), target);
}

export async function loadInputImages(
  markdown: string,
  inputPath: string,
  logger: Logger,
): Promise<DigestInputImage[]> {
  const imageTargets = extractMarkdownImageTargets(markdown);
  const loadedImages: DigestInputImage[] = [];

  for (const target of imageTargets) {
    if (isRemoteImage(target)) {
      loadedImages.push({
        url: target,
        label: target,
      });
      continue;
    }

    const absoluteImagePath = resolveLocalImagePath(inputPath, target);
    const extension = path.extname(absoluteImagePath).toLowerCase();
    const mimeType = LOCAL_IMAGE_MIME_TYPES[extension];

    if (!mimeType) {
      await logger.progress(
        "digest.image_skipped",
        `Warning: Skipping image '${target}' (unsupported type: ${extension || "unknown"}).`,
      );
      continue;
    }

    const imageFile = Bun.file(absoluteImagePath);
    const exists = await imageFile.exists();
    if (!exists) {
      await logger.progress(
        "digest.image_skipped",
        `Warning: Skipping image '${target}' (file not found).`,
      );
      continue;
    }

    const bytes = await imageFile.arrayBuffer();
    if (bytes.byteLength === 0) {
      await logger.progress(
        "digest.image_skipped",
        `Warning: Skipping image '${target}' (file is empty).`,
      );
      continue;
    }

    const base64 = Buffer.from(bytes).toString("base64");
    loadedImages.push({
      url: `data:${mimeType};base64,${base64}`,
      label: target,
    });
  }

  return loadedImages;
}
