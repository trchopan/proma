import path from "node:path";
import { pathToFileURL } from "node:url";
import type { PromaConfig, PromptPluginApi } from "./plugin";
import { createBuiltInPromptRegistry } from "./registry";
import type { PromptRegistry } from "./types";

const DEFAULT_CONFIG_FILE = "proma.config.ts";

function isPromaConfig(value: unknown): value is PromaConfig {
  if (!value || typeof value !== "object") {
    return false;
  }

  const plugins = (value as { plugins?: unknown }).plugins;
  return typeof plugins === "undefined" || Array.isArray(plugins);
}

export async function loadPromptRegistry(
  cwd = process.cwd(),
  configFileName = DEFAULT_CONFIG_FILE,
): Promise<PromptRegistry> {
  const registry = createBuiltInPromptRegistry();
  const configPath = path.resolve(cwd, configFileName);
  const file = Bun.file(configPath);

  if (!(await file.exists())) {
    return registry;
  }

  const loadedModule = await import(pathToFileURL(configPath).href);
  const configValue = loadedModule.default;

  if (!isPromaConfig(configValue)) {
    throw new Error(
      `Invalid ${configFileName}: expected default export shape { plugins?: PromptPlugin[] }`,
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
        `Invalid ${configFileName} plugin entry: expected object with name and setup`,
      );
    }

    const name = (plugin as { name?: unknown }).name;
    const setup = (plugin as { setup?: unknown }).setup;

    if (typeof name !== "string" || name.trim().length === 0) {
      throw new Error(
        `Invalid ${configFileName} plugin entry: 'name' must be a non-empty string`,
      );
    }

    if (typeof setup !== "function") {
      throw new Error(
        `Invalid ${configFileName} plugin '${name}': 'setup' must be a function`,
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
