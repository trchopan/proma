# Plugin System Guide

This guide is the detailed reference for `proma` prompt plugins.

- Use this when you need to customize how `digest`, `merge`, or `report` prompts are built or parsed.
- Keep `README.md` for quick start; use this guide for plugin architecture, recipes, and troubleshooting.

## Quick Start

Create one config file in your repository root:

- `proma.config.ts`
- `proma.config.js`
- `proma.config.mjs`

Example:

```ts
export default {
  plugins: [
    {
      name: "custom-report-tone",
      setup(api) {
        api.patchOperation("report", (current) => ({
          ...current,
          buildPrompt(context) {
            const built = current.buildPrompt(context);
            return {
              ...built,
              messages: built.messages.map((message) =>
                message.role === "system"
                  ? {
                      ...message,
                      content: `${String(message.content)}\nUse a neutral executive tone.`,
                    }
                  : message,
              ),
            };
          },
        }));
      },
    },
  ],
};
```

Verify:

```bash
bun run report -- --project ./acme --period weekly
```

Expected result: the report prompt includes your added system rule.

## Architecture and Lifecycle

Plugin composition follows this runtime flow:

1. `createBuiltInPromptRegistry()` creates built-in operations for `digest`, `merge`, and `report`.
2. Config discovery checks candidate files in deterministic order:
   - `proma.config.ts`
   - `proma.config.js`
   - `proma.config.mjs`
3. The first existing file is loaded; if none exists, built-ins are used unchanged.
4. `default` export is validated as `{ plugins?: PromptPlugin[] }`.
5. Plugins run in declaration order (`plugins[0]`, `plugins[1]`, ...). Each `setup` is awaited.
6. Final registry is validated before command execution.

Deterministic behavior:

- First matching config file wins.
- Later plugins can override earlier plugin changes.
- Async `setup` is supported (`Promise<void>`).

## API Reference

Types:

```ts
type PromptPluginApi = {
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

type PromptPlugin = {
  name: string;
  setup: (api: PromptPluginApi) => void | Promise<void>;
};
```

Method semantics:

- `getRegistry()`: returns the live mutable registry object.
- `patchOperation(kind, patcher)`: receives current operation and replaces it with patcher output.
- `overrideOperation(kind, next)`: fully replaces an operation definition.

Required operation contract (must remain valid after patches/overrides):

- `operation.kind` must match its key (`digest`, `merge`, or `report`).
- `buildPrompt` must return `{ messages, responseFormat }`.
- `responseFormat.type` must be `json_schema`.
- `parseResponse` must be a function.

## Recipes

### 1) Patch `report` system tone

```ts
export default {
  plugins: [
    {
      name: "report-tone",
      setup(api) {
        api.patchOperation("report", (current) => ({
          ...current,
          buildPrompt(context) {
            const built = current.buildPrompt(context);
            return {
              ...built,
              messages: built.messages.map((message) =>
                message.role === "system"
                  ? {
                      ...message,
                      content: `${String(message.content)}\nWrite with a concise, neutral tone.`,
                    }
                  : message,
              ),
            };
          },
        }));
      },
    },
  ],
};
```

Verify:

```bash
bun run report -- --project ./acme --period weekly --verbose
```

Expected result: verbose logs show the extra system instruction.

### 2) Patch `digest` with custom guardrails

```ts
export default {
  plugins: [
    {
      name: "digest-guardrails",
      setup(api) {
        api.patchOperation("digest", (current) => ({
          ...current,
          buildPrompt(context) {
            const built = current.buildPrompt(context);
            return {
              ...built,
              messages: built.messages.map((message) =>
                message.role === "system"
                  ? {
                      ...message,
                      content: `${String(message.content)}\nDo not invent references. Return [] when uncertain.`,
                    }
                  : message,
              ),
            };
          },
        }));
      },
    },
  ],
};
```

Verify:

```bash
bun run digest -- --project ./acme --input ./raw.md --verbose
```

Expected result: digest system prompt includes the additional guardrail sentence.

### 3) Override `merge` for controlled full replacement

```ts
export default {
  plugins: [
    {
      name: "merge-fixed-routing",
      setup(api) {
        const current = api.getRegistry().merge;
        api.overrideOperation("merge", {
          ...current,
          version: "v1-fixed-routing",
          parseResponse: (_raw, context) => {
            if (context.candidates.length === 0) {
              return [
                {
                  action: "create_new",
                  shortDescription: "general-notes",
                  tags: ["general"],
                },
              ];
            }

            return [
              {
                action: "update_existing",
                slug: context.candidates[0].slug,
              },
            ];
          },
        });
      },
    },
  ],
};
```

Verify:

```bash
bun run merge -- --project ./acme
```

Expected result: routing always targets first candidate when candidates exist, otherwise creates `general-notes`.

### 4) Multi-plugin ordering (later plugin wins)

```ts
export default {
  plugins: [
    {
      name: "report-tone-base",
      setup(api) {
        api.patchOperation("report", (current) => ({
          ...current,
          buildPrompt(context) {
            const built = current.buildPrompt(context);
            return {
              ...built,
              messages: built.messages.map((message) =>
                message.role === "system"
                  ? {
                      ...message,
                      content: `${String(message.content)}\nSTYLE=A`,
                    }
                  : message,
              ),
            };
          },
        }));
      },
    },
    {
      name: "report-tone-override",
      setup(api) {
        api.patchOperation("report", (current) => ({
          ...current,
          buildPrompt(context) {
            const built = current.buildPrompt(context);
            return {
              ...built,
              messages: built.messages.map((message) =>
                message.role === "system"
                  ? {
                      ...message,
                      content: String(message.content).replace("STYLE=A", "STYLE=B"),
                    }
                  : message,
              ),
            };
          },
        }));
      },
    },
  ],
};
```

Verify:

```bash
bun run report -- --project ./acme --period weekly --verbose
```

Expected result: final prompt contains `STYLE=B` (the later plugin output).

## Safe Extension Patterns

- Prefer `patchOperation` when possible; keep existing `buildPrompt` and `parseResponse` behavior intact.
- Use `overrideOperation` only when you need full control.
- When overriding, preserve required contract fields and schema-compatible behavior.
- Keep plugin setup deterministic and side-effect-light.

## Troubleshooting

Use this symptom -> cause -> fix mapping.

### 1) Invalid config shape

Symptom:

```txt
Invalid proma.config.ts: expected default export shape { plugins?: PromptPlugin[] }
```

Cause: `default` export is missing or is not an object with optional `plugins` array.

Fix: export an object, for example:

```ts
export default { plugins: [] };
```

### 2) Plugin entry is not an object

Symptom:

```txt
Invalid proma.config.ts plugin entry: expected object with name and setup
```

Cause: one item in `plugins` is not an object.

Fix: ensure every item is `{ name: string, setup(api) { ... } }`.

### 3) Plugin name is invalid

Symptom:

```txt
Invalid proma.config.ts plugin entry: 'name' must be a non-empty string
```

Cause: `name` is empty, missing, or non-string.

Fix: set a non-empty string name.

### 4) Plugin setup is invalid

Symptom:

```txt
Invalid proma.config.ts plugin 'my-plugin': 'setup' must be a function
```

Cause: `setup` is missing or not callable.

Fix: define `setup(api) { ... }` or `async setup(api) { ... }`.

### 5) Plugin throws during setup

Symptom:

```txt
Prompt plugin 'my-plugin' failed during setup: <original message>
```

Cause: runtime error inside `setup`.

Fix: wrap risky logic with local guards and keep setup idempotent.

### 6) Registry contract broken after patch/override

Symptom examples:

```txt
Prompt registry operation 'report' is missing parseResponse function
Prompt registry operation 'report' must use json_schema response format
```

Cause: override removed required fields or changed `responseFormat` type.

Fix: keep required operation fields (`kind`, `buildPrompt`, `parseResponse`, `json_schema` response format).

### 7) Config file appears ignored

Symptom: plugin changes do not apply.

Cause: another supported config file is found first.

Fix: keep only one config file in root, or confirm first-match order (`.ts`, then `.js`, then `.mjs`).

### Broken vs Fixed plugin example

Broken:

```ts
export default {
  plugins: [
    {
      name: "bad-plugin",
      setup(api) {
        api.overrideOperation("report", {
          kind: "report",
          version: "v2",
          buildPrompt: () => ({
            messages: [],
            responseFormat: {
              type: "json_schema",
              json_schema: {
                name: "",
                strict: true,
                schema: { type: "object" },
              },
            },
          }),
        });
      },
    },
  ],
};
```

Fixed:

```ts
export default {
  plugins: [
    {
      name: "good-plugin",
      setup(api) {
        const current = api.getRegistry().report;
        api.overrideOperation("report", {
          ...current,
          version: "v2",
          buildPrompt(context) {
            return current.buildPrompt(context);
          },
          parseResponse(raw, context) {
            return current.parseResponse(raw, context);
          },
        });
      },
    },
  ],
};
```

## Preflight Checklist

Before opening an issue, run this quick checklist:

1. Confirm exactly one supported config file exists at repo root.
2. Ensure config uses `export default { plugins: [...] }`.
3. Ensure each plugin has non-empty `name` and callable `setup`.
4. Run with `--verbose` and check logs for plugin setup errors.
5. If using overrides, verify operation contract is still valid (`parseResponse`, `json_schema`, etc.).
6. Reproduce with a minimal single-plugin config to isolate ordering effects.

Quick sanity command:

```bash
bun test tests/prompting.test.ts
```
