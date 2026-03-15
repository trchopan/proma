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

Proma also provides an MCP-based ingestion command:

- `import`: discover MCP actions or call an MCP tool and write raw markdown under `<project>/imports` for the digest pipeline.

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
proma merge --project ./acme --auto-merge

# report
proma report --project ./acme --period weekly
proma report --project ./acme --period weekly --dry-run

# import action discovery
proma import --server mcp.slack --list-actions
proma import --server mcp.slack --list-actions --verbose

# import GitHub actions (uses local gh auth)
proma import --server github --list-actions

# import tool call (default: prints markdown to stdout)
proma import --server mcp.slack --tool fetch_thread --args '{"channel":"C123","thread_ts":"1710.123"}'
proma import --server mcp.slack --tool fetch_thread --args '{"channel":"C123"}' > ./acme/imports/slack-thread.md
proma import --server mcp.slack --tool fetch_thread --args '{"channel":"C123"}' --output ./acme/imports/slack-thread.md

# import GitHub issue / PR data
proma import --server github --tool issue_get --args '{"owner":"acme","repo":"platform","number":123}'
proma import --server github --tool pr_get --args '{"owner":"acme","repo":"platform","number":456}'
proma import --server github --tool prs_list --args '{"owner":"acme","repo":"platform","author":"alice","state":"all","per_page":20,"page":1}'

# handoff from import -> digest
proma digest --project ./acme --input ./acme/imports/2026-03-12_slack_fetch-thread.md

# report with explicit topic inputs + base reports
proma report --project ./acme --period weekly \
  --input ./acme/topics/planning/release-readiness.md \
  --input ./acme/topics/decision/incident-response.md \
  --base ./acme/reports/2026-03-01_weekly.md \
  --base ./acme/reports/2026-03-08_weekly.md
```

Optional flags:

- `--model <name>`: override model (example: `proma digest --input ./raw.md --project ./acme --model gpt-4.1-mini`).
- `--verbose`: enable detailed debug logs.
- `--dry-run`: skip AI requests and file writes.
- `--config <file>`: override config file path (default: `<cwd>/proma.config.ts`).
- `--auto-merge`: for `merge` only, auto-apply proposed merges without confirmation (diff previews are still printed).
- `--server`: for `import` only, must be either built-in `github` or `mcp.<server_name>` from project config.
- `--list-actions`: for `import` only, lists MCP actions for the selected server.
- `--tool <name>` + `--args <json>`: for `import` only, executes one MCP tool call with JSON object arguments.
- `--output <file>`: for `import` only, writes markdown output to the provided file path. When omitted, import prints markdown to stdout.

Note: the digest flow uses OpenAI Structured Outputs (`json_schema`) and fails fast if the selected model does not support it.

## File layout and behavior

`--project` is the root output directory for `digest`, `merge`, and `report`.

`import` is project-free: it prints markdown to stdout by default and only writes files when `--output <file>` is provided.

- Raw digest notes: `<project>/notes/<category>_<YYYY-MM-DD>_<index>.md`
- Topic files from `merge`: `<project>/topics/<category>/<topic-slug>.md`
- Reports: `<project>/reports/<YYYY-MM-DD>_<period>.md` (collision fallback: `_2`, `_3`, ...)

Report behavior:

- `--period` is optional; default is `weekly`. Valid values: `daily`, `weekly`, `bi-weekly`, `monthly`.
- Repeat `--input` to target specific markdown files; when omitted, the CLI scans markdown files under `<project>/topics/planning`, `<project>/topics/research`, and `<project>/topics/decision`.
- Repeat `--base` to provide specific previous reports; when omitted, the CLI loads markdown files under `<project>/reports`.
- Report files include YAML front matter with `period`, `generated_at`, `model`, `input_files`, and `base_reports`.

Digest note behavior:

- Digest note files include YAML front matter with `category`, `source`, `merged`, and `merged_topic_paths`.
- `merge` only picks files where `merged` is not `true`.

Topic file behavior:

- Topic files include YAML front matter metadata (`category`, `created_at`, `updated_at`, `tags`, `sources`, `digested_note_paths`).
- `digested_note_paths` stores merged digest-note IDs (project-relative note paths such as `notes/planning_2026-03-09_1.md`).
- The topic name is stored in the markdown level-1 title (`# ...`) at the top of the file body.
- Tag metadata is normalized to lowercase kebab-case, deduplicated, and sorted; merge prefers reusing existing category tags before adding new ones.
- New topic slugs are normalized to kebab-case and capped at 100 characters.
- Topic files are canonical-only and category-specific:
  - `decision`: `Summary`, `Decision`, `Context`, `Options Considered`, `Rationale / Tradeoffs`, `Stakeholders`, `References`
  - `research`: `Summary`, `Problem Statement`, `Research Plan`, `Key Findings`, `Person in Charge`, `References`
  - `planning`: `Summary`, `Objectives / Success Criteria`, `Scope`, `Deliverables`, `Plan`, `Timeline`, `Teams/Individuals Involved`, `References`
- Planning participant identity formatting (when handles are available):
  - full identity: `Display Name (platform:identity handle)`
  - handle-only identity: `(platform:identity handle)`
  - platform label follows source naming (for example `git`, `slack`)
- Merge routes each digest note to exactly one primary topic target.
- Merge prefers durable workstream-level topics over note/PR-specific topic files across all sources (`git`, `slack`, `wiki`, `document`).
- Timebox signals (for example `release/x.y.z`, `sprint-<n>`, `Qn-YYYY`) are treated as hard split boundaries when present.
- Project/product identity signals (for example `project-atlas-api`, `project-orion-web`) are treated as hard split boundaries to avoid cross-project topic contamination.
- Merge pre-ranks candidates deterministically and sends only the top 8 candidates to routing.
- Merge applies semantic content refinement to reduce unrelated/duplicated key points and timeline entries, with deterministic fallback on failure.
- Repeated ingestion of already-merged references becomes a no-op (`No topic change`).
- After topic targets are selected, the CLI shows a diff preview for each proposed merge. By default it asks for confirmation (`y` to apply, default `N` to skip); with `--auto-merge`, it applies automatically without prompting.

Generated markdown sections:

- Digest notes (`notes/*.md`) use: `## Summary`, `## Key Points`, `## Timeline`, `## References`.
- Topic files (`topics/*/*.md`) use category-specific sections (see Topic file behavior above).
- Planning timeline entries, when present, must use strict `YYYY-MM-DD - <context>` format.
- `## References` entries use `- <source>: <link>` format (example: `- slack: https://...`).
- Allowed digest/reference sources default to: `slack`, `wiki`, `git`, `document`.

Project config override:

- Commands discover config from the current working directory (repo root where you run `proma`), not from `--project`.
- Default config path is `<cwd>/proma.config.ts`; you can override with `--config <file>`.
- If `--config` is provided and the file does not exist, command execution fails.
- Config export must be a default object. Supported keys:
  - `digest.allowedSources`
  - `github.host` (optional GitHub host for `--server github`, example: `git.linecorp.com`)
  - `mcp.<serverName>` with local server config (`type`, `command`)

```ts
// proma.config.ts
export default {
  digest: {
    allowedSources: ["jira", "notion"],
  },
  github: {
    host: "git.linecorp.com",
  },
  mcp: {
    slack: {
      type: "local",
      command: ["bun", "./scripts/slack-mcp.ts"],
    },
  },
};
```

- Effective allowed sources are `defaults + custom` (union, lowercase, deduped).
- `import --server github` uses built-in GitHub import with local `gh` auth.
- `github.host` is optional; when set, Proma runs `gh api --hostname <host> ...` for GitHub import calls.
- `import --server mcp.<name>` resolves `<name>` from `config.mcp` and is case-sensitive.
- Breaking change: legacy bare MCP names like `--server slack` are rejected; use `--server mcp.slack`.

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
