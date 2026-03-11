# Proma - Project Management Toolkit powered by LLMs

Source: [https://github.com/trchopan/proma](https://github.com/trchopan/proma)

## Get started

Install as a dependency:

```bash
npm install @trchopan/proma
# or
bun add @trchopan/proma
```

Set your API key:

```bash
export OPENAI_API_KEY="your_api_key"
```

Optional scripts:

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

- `report` defaults to `weekly` when `--period` is omitted.
- Use `--dry-run` to preview AI requests and planned actions without sending requests or writing files.

## Develop proma locally

To install dependencies:

```bash
bun install
```

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

Then use the entry point to run:

```bash
bun run ./bin/proma.ts
```

## CLI workflow

Proma runs in three commands:

- `digest`: parse raw notes and write digest notes.
- `merge`: process pending digest notes into canonical topic files.
- `report`: generate a period report from topic files (and optional base reports).

Digest summaries and key points are always generated in English, even when input notes are in another language.
Digest input supports markdown images (`![alt](./image.png)`); missing or unsupported local images are skipped with a warning.

Prompting and schema control is centralized in `src/prompting/`:

- `src/prompting/registry.ts` contains built-in operation definitions for `digest`, `merge`, and `report`
- `src/prompting/execute.ts` runs model calls from operation contracts
- `src/prompting/validate.ts` validates registry contracts at startup

Examples:

```bash
# digest
proma digest --input ./raw.md --project ./acme
proma digest --input ./raw.md --project ./acme --verbose
proma digest --input ./raw.md --project ./acme --dry-run

# merge
proma merge --project ./acme
proma merge --project ./acme --verbose
proma merge --project ./acme --dry-run

# report
proma report --project ./acme --period weekly
proma report --project ./acme --period weekly --dry-run

# report with explicit topic inputs + base reports
proma report --project ./acme --period weekly \
  --input ./acme/topics/planning/release-readiness.md \
  --input ./acme/topics/discussion/incident-response.md \
  --base ./acme/reports/2026-03-01_weekly.md \
  --base ./acme/reports/2026-03-08_weekly.md
```

Optional flags:

- `--model <name>`: override model (example: `proma digest --input ./raw.md --project ./acme --model gpt-4.1-mini`).
- `--verbose`: enable detailed debug logs.
- `--dry-run`: skip AI requests and file writes.

Note: the digest flow uses OpenAI Structured Outputs (`json_schema`) and fails fast if the selected model does not support it.

## File layout and behavior

`--project` is the root output directory.

- Raw digest notes: `<project>/notes/<category>_<YYYY-MM-DD>_<index>.md`
- Topic files from `merge`: `<project>/topics/<category>/<topic-slug>.md`
- Reports: `<project>/reports/<YYYY-MM-DD>_<period>.md` (collision fallback: `_2`, `_3`, ...)

Report behavior:

- `--period` is optional; default is `weekly`. Valid values: `daily`, `weekly`, `bi-weekly`, `monthly`.
- Repeat `--input` to target specific markdown files; when omitted, the CLI scans markdown files under `<project>/topics/planning`, `<project>/topics/research`, and `<project>/topics/discussion`.
- Repeat `--base` to provide specific previous reports; when omitted, the CLI loads markdown files under `<project>/reports`.
- Report files include YAML front matter with `period`, `generated_at`, `model`, `input_files`, and `base_reports`.

Digest note behavior:

- Digest note files include YAML front matter with `category`, `source`, `merged`, and `merged_topic_paths`.
- `merge` only picks files where `merged` is not `true`.

Topic file behavior:

- Topic files include YAML front matter metadata (`category`, `created_at`, `updated_at`, `tags`, `sources`, `digested_note_paths`).
- `digested_note_paths` stores merged digest-note IDs (project-relative note paths such as `notes/planning_2026-03-09_1.md`).
- The topic name is stored in the markdown level-1 title (`# ...`) at the top of the file body.
- Tag metadata is normalized to lowercase kebab-case, deduplicated, and sorted.
- New topic slugs are normalized to kebab-case and capped at 100 characters.
- Topic files are canonical-only: each file keeps a single merged `Summary/Key Points/Timeline/References` view.
- Repeated ingestion of already-merged references becomes a no-op (`No topic change`).
- After topic targets are selected, the CLI shows a diff preview for each proposed merge and asks for confirmation (`y` to apply, default `N` to skip).

Generated markdown sections:

- `## Summary`
- `## Key Points`
- `## Timeline` (always present; use `- None` when no date context is available)
- Timeline entries, when present, must use strict `YYYY-MM-DD - <context>` format
- `## References` entries in `- <source>: <link>` format (example: `- slack: https://...`)
- Allowed digest/reference sources: `slack`, `wiki`, `git`, `document` (use `document` for Figma and document links)

## Logging

- Every run writes structured logs to `logs/<YYYY-MM-DD>/*.jsonl` by default.
- Without `--verbose`, console output is progress-focused.
- With `--verbose`, console shows heavy debug logs and file logs include full AI prompt/response text.
- With `--dry-run`, AI requests are not sent and file writes are skipped (including output files and log files).

## Implementation notes

- `src/cli.ts` orchestrates commands; `src/cli/` holds helpers for args, diff preview, and markdown image loading.
- `src/files.ts` is a barrel export surface for storage modules under `src/storage/`.
- Markdown parsing/rendering concerns live in `src/markdown/`.
- Topic merge decision logic is isolated in `src/services/topic-merge.ts`.
- Runtime defaults and endpoint resolution are centralized in `src/config.ts`.

## License

MIT. See `LICENSE`.
