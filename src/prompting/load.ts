import path from "node:path";
import { pathToFileURL } from "node:url";
import type { PromaConfig, PromptPluginApi } from "./plugin";
import { createBuiltInPromptRegistry } from "./registry";
import type { PromptRegistry } from "./types";

const SUPPORTED_CONFIG_FILES = [
  "proma.config.ts",
  "proma.config.js",
  "proma.config.mjs",
] as const;

function isPromaConfig(value: unknown): value is PromaConfig {
  if (!value || typeof value !== "object") {
    return false;
  }

  const plugins = (value as { plugins?: unknown }).plugins;
  return typeof plugins === "undefined" || Array.isArray(plugins);
}

/**
 * Loads and composes the prompt registry for CLI execution.
 *
 * Behavior:
 * - Starts from built-in operations (`digest`, `merge`, `report`).
 * - If `configFileName` is provided, only that file name is checked.
 * - Otherwise config discovery uses first-match order:
 *   `proma.config.ts` -> `proma.config.js` -> `proma.config.mjs`.
 * - If no config file exists, built-ins are returned unchanged.
 * - Plugins run in declaration order and each `setup` is awaited.
 *
 * Throws when config shape is invalid, plugin entries are malformed, or a
 * plugin throws/rejects during setup.
 *
 * @param cwd Directory used to resolve config candidates.
 * @param configFileName Optional explicit config filename to load.
 * @returns Final composed registry used by command execution.
 */
export async function loadPromptRegistry(
  cwd = process.cwd(),
  configFileName?: string,
): Promise<PromptRegistry> {
  const registry = createBuiltInPromptRegistry();
  const candidateNames =
    typeof configFileName === "string"
      ? [configFileName]
      : [...SUPPORTED_CONFIG_FILES];
  let configPath: string | undefined;

  for (const candidateName of candidateNames) {
    const candidatePath = path.resolve(cwd, candidateName);
    const candidateFile = Bun.file(candidatePath);
    if (await candidateFile.exists()) {
      configPath = candidatePath;
      break;
    }
  }

  if (!configPath) {
    return registry;
  }

  const selectedConfigFileName = path.basename(configPath);

  const loadedModule = await import(pathToFileURL(configPath).href);
  const configValue = loadedModule.default;

  if (!isPromaConfig(configValue)) {
    throw new Error(
      `Invalid ${selectedConfigFileName}: expected default export shape { plugins?: PromptPlugin[] }`,
    );
  }

  const plugins = configValue.plugins ?? [];
  const api: PromptPluginApi = {
    getRegistry: () => registry,
    patchOperation: (kind, patcher) => {
      registry[kind] = patcher(registry[kind]) as never;
    },
    overrideOperation: (kind, next) => {
      registry[kind] = next as never;
    },
  };

  for (const plugin of plugins) {
    if (!plugin || typeof plugin !== "object") {
      throw new Error(
        `Invalid ${selectedConfigFileName} plugin entry: expected object with name and setup`,
      );
    }

    const name = (plugin as { name?: unknown }).name;
    const setup = (plugin as { setup?: unknown }).setup;

    if (typeof name !== "string" || name.trim().length === 0) {
      throw new Error(
        `Invalid ${selectedConfigFileName} plugin entry: 'name' must be a non-empty string`,
      );
    }

    if (typeof setup !== "function") {
      throw new Error(
        `Invalid ${selectedConfigFileName} plugin '${name}': 'setup' must be a function`,
      );
    }

    try {
      await setup(api);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown plugin error";
      throw new Error(
        `Prompt plugin '${name}' failed during setup: ${message}`,
      );
    }
  }

  return registry;
}
