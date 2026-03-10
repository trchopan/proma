# proma

## Get started

Install as a dependency:

```bash
npm install @trchopan/proma
# or
bun add @trchopan/proma
```

Create `proma.config.js` in your repository root:

For full plugin architecture, recipes, and troubleshooting, see `PLUGIN_SYSTEM.md`.

```js
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
                      content: `${message.content}\nUse a neutral executive tone.`,
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

Add scripts:

```json
{
  "scripts": {
    "digest": "proma digest --project ./docs --input ./docs/raw.md",
    "merge": "proma merge --project ./docs",
    "report": "proma report --project ./docs"
  }
}
```

Then run `bun run digest`, `bun run merge`, and `bun run report`.

Notes:

- Supported config files are `proma.config.ts`, `proma.config.js`, and `proma.config.mjs`.
- `report` defaults to `weekly` when `--period` is omitted.
- Set `OPENAI_API_KEY` in your environment before running commands.

## Develop proma locally

To install dependencies:

```bash
bun install
```

## Digest CLI feature

The `digest` command reads an input text file, asks OpenAI to split/classify it into digest items, and writes stage-1 note files.
The `merge` command then processes pending stage-1 notes into topic files.
Digest summaries and key points are always generated in English, even when input notes are in another language.
Digest input also supports markdown images (`![alt](./image.png)`), which are loaded and included in the AI prompt.
Missing or unsupported local images are skipped with a warning, and digest generation continues.

Prompting and schema control is centralized in `src/prompting/`:

- `src/prompting/registry.ts` contains built-in operation definitions for `digest`, `merge`, and `report`
- `src/prompting/execute.ts` runs model calls from operation contracts
- `src/prompting/load.ts` loads optional user plugins from `proma.config.ts|js|mjs`
- `src/prompting/validate.ts` validates composed registry contracts at startup

Deep plugin documentation: `PLUGIN_SYSTEM.md`

Create `proma.config.ts` (or `.js`/`.mjs`) to customize prompting behavior via plugins:

Need advanced examples (`overrideOperation`, multi-plugin order, troubleshooting)? See `PLUGIN_SYSTEM.md`.

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
                      content: `${message.content}\nUse a neutral executive tone.`,
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

Plugin order is deterministic: plugins run in declaration order and later patches can override earlier ones.

Required environment variable:

```bash
export OPENAI_API_KEY="your_api_key"
```

Run stage 1 (`digest`):

```bash
proma digest --input ./raw.md --project ./acme
```

Run stage 1 with verbose debugging logs:

```bash
proma digest --input ./raw.md --project ./acme --verbose
```

Run stage 2/3 (`merge`):

```bash
proma merge --project ./acme
```

Run stage 2/3 with verbose debugging logs:

```bash
proma merge --project ./acme --verbose
```

Run report generation (`report`):

```bash
proma report --project ./acme --period weekly
```

Run report generation with explicit topic inputs and base reports:

```bash
proma report --project ./acme --period weekly \
  --input ./acme/planning/release-readiness.md \
  --input ./acme/discussion/incident-response.md \
  --base ./acme/reports/2026-03-01_weekly.md \
  --base ./acme/reports/2026-03-08_weekly.md
```

Optional model override:

```bash
proma digest --input ./raw.md --project ./acme --model gpt-4.1-mini
```

Note: the digest flow uses OpenAI Structured Outputs (`json_schema`) and fails fast if the selected model does not support it.

`--project` is the root output directory. Output structure:

- Stage 1 raw digests: `<project>/notes/<category>_<YYYY-MM-DD>_<index>.md`
- Stage 2/3 topic files from `merge`: `<project>/<category>/<topic-slug>.md`
- Reports: `<project>/reports/<YYYY-MM-DD>_<period>.md` (collision fallback: `_2`, `_3`, ...)

Report file behavior:

- `--period` is optional; default is `weekly`. Valid values: `daily`, `weekly`, `bi-weekly`, `monthly`.
- Repeat `--input` to target specific markdown files; when omitted, the CLI scans all markdown files under `<project>/planning`, `<project>/research`, and `<project>/discussion`.
- Repeat `--base` to provide specific previous reports; when omitted, the CLI loads all markdown files under `<project>/reports`.
- Report files include YAML front matter with `period`, `generated_at`, `model`, `input_files`, and `base_reports`.

Stage-1 files include YAML front matter with `category`, `source`, and `merged`.
`merge` only picks files where `merged` is not `true`.

Topic files include YAML front matter metadata (`topic`, `category`, `created_at`, `updated_at`, `tags`, `sources`, `merged_digest_ids`).
Tag metadata is normalized to lowercase kebab-case, deduplicated, and sorted.

Topic files are canonical-only: each file keeps a single merged `Summary/Key Points/Timeline/References` view instead of appending chronological digest entries.
Repeated ingestion of already-merged references becomes a no-op (`No topic change`).

After topic targets are selected, the CLI shows a diff preview for each proposed merge and asks for confirmation (`y` to apply, default `N` to skip).

Logging behavior:

- Every run writes structured logs to `logs/<YYYY-MM-DD>/*.jsonl` by default.
- Without `--verbose`, console output is progress-focused.
- With `--verbose`, console shows heavy debug logs and file logs include full AI prompt/response text.

Implementation structure (refactor baseline):

- `src/cli.ts` orchestrates commands, while `src/cli/` holds focused helpers for args, diff preview, and markdown image loading.
- `src/files.ts` is a barrel export surface for storage modules under `src/storage/`.
- Markdown parsing/rendering concerns live in `src/markdown/`.
- Topic merge decision logic is isolated in `src/services/topic-merge.ts`.
- Runtime defaults and endpoint resolution are centralized in `src/config.ts`.

Each generated markdown file includes:

- `## Summary`
- `## Key Points`
- `## Timeline` (always present; use `- None` when no date context is available)
- Timeline entries, when present, must use strict `YYYY-MM-DD - <context>` format
- `## References` entries in `- <source>: <link>` format (for example `- slack: https://...`)
- Allowed digest/reference sources: `slack`, `wiki`, `git`, `figma`, `file` (use `file` for document links such as Google Drive)

Development commands:

```bash
# lint
bun run lint
bun run lint:fix

# format
bun run format
bun run format:check

# tests
bun run test
bun run test:watch

# type checking
bun run typecheck

# run all checks
bun run check
```

Git hook:

```bash
# installed automatically on bun install via "prepare"
# pre-commit runs lint-staged + typecheck
```

This project was created using `bun init` in bun v1.3.9. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.

## License

MIT. See `LICENSE`.
