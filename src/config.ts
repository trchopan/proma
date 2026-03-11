import path from "node:path";
import { pathToFileURL } from "node:url";

export const DEFAULT_MODEL = "gpt-5.2";

const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com";
const CONFIG_FILE_NAMES = [
  "proma.config.ts",
  "proma.config.mjs",
  "proma.config.js",
] as const;
const DEFAULT_DIGEST_SOURCES = ["slack", "wiki", "git", "document"] as const;

export type ProjectConfig = {
  digest?: {
    allowedSources?: string[];
  };
};

function normalizeSources(values: string[]): string[] {
  return [
    ...new Set(
      values.map((value) => value.trim().toLowerCase()).filter(Boolean),
    ),
  ].sort();
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function validateProjectConfig(
  raw: unknown,
  configPath: string,
): ProjectConfig {
  if (!isObject(raw)) {
    throw new Error(
      `Invalid project config at ${configPath}: default export must be an object`,
    );
  }

  const digest = raw.digest;
  if (typeof digest === "undefined") {
    return {};
  }

  if (!isObject(digest)) {
    throw new Error(
      `Invalid project config at ${configPath}: digest must be an object`,
    );
  }

  const allowedSources = digest.allowedSources;
  if (typeof allowedSources === "undefined") {
    return { digest: {} };
  }

  if (!Array.isArray(allowedSources)) {
    throw new Error(
      `Invalid project config at ${configPath}: digest.allowedSources must be an array of strings`,
    );
  }

  const hasNonString = allowedSources.some(
    (value) => typeof value !== "string",
  );
  if (hasNonString) {
    throw new Error(
      `Invalid project config at ${configPath}: digest.allowedSources must be an array of strings`,
    );
  }

  return {
    digest: {
      allowedSources: normalizeSources(allowedSources as string[]),
    },
  };
}

async function loadConfigModule(configPath: string): Promise<ProjectConfig> {
  let loaded: unknown;

  try {
    loaded = await import(pathToFileURL(configPath).href);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown import error";
    throw new Error(
      `Failed to load project config at ${configPath}: ${message}`,
    );
  }

  const raw =
    isObject(loaded) && "default" in loaded
      ? (loaded as { default: unknown }).default
      : loaded;
  return validateProjectConfig(raw, configPath);
}

export async function loadProjectConfig(
  projectRoot: string,
): Promise<ProjectConfig> {
  for (const fileName of CONFIG_FILE_NAMES) {
    const configPath = path.join(projectRoot, fileName);
    if (!(await Bun.file(configPath).exists())) {
      continue;
    }

    return loadConfigModule(configPath);
  }

  return {};
}

export function resolveDigestAllowedSources(config: ProjectConfig): string[] {
  const configured = config.digest?.allowedSources ?? [];
  return normalizeSources([...DEFAULT_DIGEST_SOURCES, ...configured]);
}

export function resolveOpenAiChatCompletionsUrl(): string {
  const configuredBaseUrl = process.env.OPENAI_BASE_URL?.trim();

  if (!configuredBaseUrl) {
    return `${DEFAULT_OPENAI_BASE_URL}/v1/chat/completions`;
  }

  const normalizedBaseUrl = configuredBaseUrl.replace(/\/+$/, "");

  if (normalizedBaseUrl.endsWith("/chat/completions")) {
    return normalizedBaseUrl;
  }

  if (normalizedBaseUrl.endsWith("/v1")) {
    return `${normalizedBaseUrl}/chat/completions`;
  }

  return `${normalizedBaseUrl}/v1/chat/completions`;
}
