# proma

To install dependencies:

```bash
bun install
```

To run:

```bash
bun run index.ts
```

## Digest CLI feature

The `digest` command reads an input text file, asks OpenAI to split/classify it into digest items, and writes stage-1 note files.
The `merge` command then processes pending stage-1 notes into topic files.
Digest summaries and key points are always generated in English, even when input notes are in another language.
Digest input also supports markdown images (`![alt](./image.png)`), which are loaded and included in the AI prompt.
Missing or unsupported local images are skipped with a warning, and digest generation continues.

Prompt templates are loaded from committed markdown files:

- `prompts/digest.md`
- `prompts/merge.md`

Template format:

- `# {{SYSTEM}}` for the system prompt section
- `# {{USER}}` for the user prompt section
- `{{VARIABLE_NAME}}` placeholders for values injected at runtime

Available placeholders:

- `prompts/digest.md`: `{{INPUT_TEXT}}`, `{{ALLOWED_SOURCES}}`
- `prompts/merge.md`: `{{DIGEST_ITEM_JSON}}`, `{{CANDIDATE_TOPIC_FILES}}`

Required environment variable:

```bash
export OPENAI_API_KEY="your_api_key"
```

Run stage 1 (`digest`):

```bash
bun run index.ts digest --input ./notes.txt --project ./acme
```

Run stage 1 with verbose debugging logs:

```bash
bun run index.ts digest --input ./notes.txt --project ./acme --verbose
```

Run stage 2/3 (`merge`):

```bash
bun run index.ts merge --project ./acme
```

Run stage 2/3 with verbose debugging logs:

```bash
bun run index.ts merge --project ./acme --verbose
```

Optional model override:

```bash
bun run index.ts digest --input ./notes.txt --project ./acme --model gpt-4.1-mini
```

Note: the digest flow uses OpenAI Structured Outputs (`json_schema`) and fails fast if the selected model does not support it.

`--project` is the root output directory. Output structure:

- Stage 1 raw digests: `<project>/notes/<category>_<YYYY-MM-DD>_<index>.md`
- Stage 2/3 topic files from `merge`: `<project>/<category>/<topic-slug>.md`

Stage-1 files include YAML front matter with `category`, `source`, and `merged`.
`merge` only picks files where `merged` is not `true`.

Topic files include YAML front matter metadata (`topic`, `category`, `created_at`, `updated_at`, `tags`, `sources`, `source_refs`, `merged_digest_ids`).
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
