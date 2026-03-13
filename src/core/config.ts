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
  github?: {
    host?: string;
  };
  mcp?: Record<string, McpLocalServerConfig>;
};

export type McpLocalServerConfig = {
  type: "local";
  command: string[];
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

  const normalized: ProjectConfig = {};

  const digest = raw.digest;
  if (typeof digest !== "undefined") {
    if (!isObject(digest)) {
      throw new Error(
        `Invalid project config at ${configPath}: digest must be an object`,
      );
    }

    const allowedSources = digest.allowedSources;
    if (typeof allowedSources === "undefined") {
      normalized.digest = {};
    } else {
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

      normalized.digest = {
        allowedSources: normalizeSources(allowedSources as string[]),
      };
    }
  }

  const mcp = raw.mcp;
  if (typeof mcp !== "undefined") {
    if (!isObject(mcp) || Array.isArray(mcp)) {
      throw new Error(
        `Invalid project config at ${configPath}: mcp must be an object keyed by server name`,
      );
    }

    const servers: Record<string, McpLocalServerConfig> = {};

    for (const [name, serverRaw] of Object.entries(mcp)) {
      if (!isObject(serverRaw) || Array.isArray(serverRaw)) {
        throw new Error(
          `Invalid project config at ${configPath}: mcp.${name} must be an object`,
        );
      }

      if (serverRaw.type !== "local") {
        throw new Error(
          `Invalid project config at ${configPath}: mcp.${name}.type must be "local"`,
        );
      }

      const command = serverRaw.command;
      if (!Array.isArray(command) || command.length === 0) {
        throw new Error(
          `Invalid project config at ${configPath}: mcp.${name}.command must be a non-empty string array`,
        );
      }

      const normalizedCommand = command.map((entry) =>
        typeof entry === "string" ? entry.trim() : "",
      );
      if (normalizedCommand.some((entry) => entry.length === 0)) {
        throw new Error(
          `Invalid project config at ${configPath}: mcp.${name}.command must be a non-empty string array`,
        );
      }

      servers[name] = {
        type: "local",
        command: normalizedCommand,
      };
    }

    normalized.mcp = servers;
  }

  const github = raw.github;
  if (typeof github !== "undefined") {
    if (!isObject(github) || Array.isArray(github)) {
      throw new Error(
        `Invalid project config at ${configPath}: github must be an object`,
      );
    }

    const hostRaw = github.host;
    if (typeof hostRaw !== "undefined") {
      if (typeof hostRaw !== "string" || hostRaw.trim().length === 0) {
        throw new Error(
          `Invalid project config at ${configPath}: github.host must be a non-empty string`,
        );
      }

      normalized.github = {
        host: hostRaw.trim(),
      };
    } else {
      normalized.github = {};
    }
  }

  return normalized;
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
  options: {
    configPath?: string;
    required?: boolean;
  } = {},
): Promise<ProjectConfig> {
  if (options.configPath) {
    const configPath = path.resolve(options.configPath);
    const exists = await Bun.file(configPath).exists();
    if (!exists) {
      if (options.required) {
        throw new Error(`Config file not found: ${configPath}`);
      }

      return {};
    }

    return loadConfigModule(configPath);
  }

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

export function resolveMcpServer(
  config: ProjectConfig,
  name: string,
): McpLocalServerConfig {
  const server = config.mcp?.[name];
  if (!server) {
    throw new Error(`Unknown MCP server: ${name}`);
  }

  return server;
}

export function resolveGithubHost(config: ProjectConfig): string | undefined {
  const host = config.github?.host?.trim();
  if (!host) {
    return undefined;
  }

  return host;
}
