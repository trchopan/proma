import type { ProcessingKind, PromptRegistry } from "./types";

/**
 * API exposed to each prompt plugin during setup.
 *
 * Plugins run in declaration order from `proma.config.*`, so later plugins can
 * patch or override changes made by earlier plugins.
 */
export type PromptPluginApi = {
  /**
   * Returns the live mutable prompt registry composed so far.
   */
  getRegistry: () => PromptRegistry;

  /**
   * Replaces one operation using a patcher function.
   *
   * @param kind Operation key to patch (`digest`, `merge`, `report`).
   * @param patcher Function that receives the current operation definition and
   * returns the replacement definition.
   */
  patchOperation: <K extends ProcessingKind>(
    kind: K,
    patcher: (current: PromptRegistry[K]) => PromptRegistry[K],
  ) => void;

  /**
   * Fully replaces one operation definition.
   *
   * Use this when you need full control over operation behavior instead of
   * incremental patching.
   *
   * @param kind Operation key to replace (`digest`, `merge`, `report`).
   * @param next Complete replacement operation definition.
   */
  overrideOperation: <K extends ProcessingKind>(
    kind: K,
    next: PromptRegistry[K],
  ) => void;
};

/**
 * Prompt plugin contract loaded from `proma.config.ts|js|mjs`.
 *
 * @example
 * ```ts
 * export default {
 *   plugins: [
 *     {
 *       name: "custom-report-tone",
 *       setup(api) {
 *         api.patchOperation("report", (current) => ({
 *           ...current,
 *           buildPrompt(context) {
 *             const built = current.buildPrompt(context);
 *             return {
 *               ...built,
 *               messages: built.messages.map((message) =>
 *                 message.role === "system"
 *                   ? {
 *                       ...message,
 *                       content: `${String(message.content)}\nUse a neutral executive tone.`,
 *                     }
 *                   : message,
 *               ),
 *             };
 *           },
 *         }));
 *       },
 *     },
 *   ],
 * };
 * ```
 */
export type PromptPlugin = {
  /** Stable display name used in plugin error messages. */
  name: string;

  /**
   * Hook executed once during registry composition.
   *
   * Throwing or rejecting aborts CLI startup for the current command.
   */
  setup: (api: PromptPluginApi) => void | Promise<void>;
};

/**
 * User config shape exported from `proma.config.ts|js|mjs`.
 */
export type PromaConfig = {
  /** Ordered plugin list; omitted means no user plugins are applied. */
  plugins?: PromptPlugin[];
};
