import type { ProcessingKind, PromptRegistry } from "./types";

export type PromptPluginApi = {
  getRegistry: () => PromptRegistry;
  patchOperation: <K extends ProcessingKind>(
    kind: K,
    patcher: (current: PromptRegistry[K]) => PromptRegistry[K],
  ) => void;
  overrideOperation: <K extends ProcessingKind>(
    kind: K,
    next: PromptRegistry[K],
  ) => void;
};

export type PromptPlugin = {
  name: string;
  setup: (api: PromptPluginApi) => void | Promise<void>;
};

export type PromaConfig = {
  plugins?: PromptPlugin[];
};
