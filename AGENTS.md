# AGENTS.md

This document is the authoritative operating manual for autonomous coding agents working in this repository.

If a task conflicts with this file, follow this file.

---

## 1) Project Mission and Non-Negotiables

Proma is a Bun-native CLI toolkit that turns raw project notes into:
1) digest notes,
2) canonical topic files,
3) periodic reports,
with optional MCP/GitHub imports.

Agent priorities in order:
1. Preserve data correctness and markdown contracts
2. Preserve CLI contract and side-effect guarantees
3. Keep behavior deterministic and test-covered
4. Keep architecture boundaries clean

You MUST:
- Use Bun-first workflows (`bun`, `bun run`, `bun test`, `bunx`).
- Preserve strict structured output (`json_schema`) behavior for AI operations.
- Keep all user-facing markdown content generation rules intact (section names and formats are contract-level).
- Update tests for every behavior change.
- Update docs when CLI behavior/flags/file layout changes.

You MUST NEVER:
- Introduce Node/NPM-only workflows where Bun equivalents exist.
- Add silent behavior changes to `digest`, `merge`, `report`, or `import`.
- Bypass `--dry-run` guarantees.
- Write logs/files or call external services during dry run.
- Commit secrets (`OPENAI_API_KEY`, credentials, tokens, `.env`).

---

## 2) Required Toolchain and Setup

## Runtime / Language
- Bun (latest stable)
- TypeScript (strict mode)
- Biome (lint + format)
- Husky + lint-staged

## First-time setup
```bash
bun install
bun run typecheck
bun run test
```

## Environment variables
- `OPENAI_API_KEY` (required for non-dry-run AI calls)
- `OPENAI_BASE_URL` (optional; normalized to `/v1/chat/completions`)
- `NO_COLOR` (optional; disables ANSI diff color in merge preview)

Bun auto-loads `.env`; do not add dotenv dependency.

---

## 3) Canonical Dev Commands

Use exactly these commands unless task explicitly requires otherwise.

```bash
# lint
bun run lint
bun run lint:fix

# format
bun run format
bun run format:check

# type-check
bun run typecheck

# tests
bun run test
bun run test:watch

# full local gate (same intent as CI)
bun run check

# run CLI locally
bun run ./bin/proma.ts --help
bun run ./bin/proma.ts digest --input ./tmp/raw/raw-1.md --project ./tmp/proj --dry-run
```

No dedicated bundling/build artifact step exists for app code; release is operational (versioning/docs/git flow), not transpiled package build.

---

## 4) Repository Layout Conventions

Top-level:
- `bin/proma.ts` - executable entrypoint
- `index.ts` - public export surface
- `src/` - implementation
- `tests/` - Bun tests
- `docs/tickets/` - ticket specs (`TEMPLATE.md` authoritative)
- `docs/releases/` - frozen release records and amendments
- `logs/` - runtime JSONL logs

`src/` layering is mandatory:
- `src/cli*` - CLI parsing/orchestration/UI prompts
- `src/core/*` - shared config, errors, logging, prompting contracts
- `src/domain/*` - digest/merge/report business logic
- `src/storage/*` - filesystem persistence and file resolution
- `src/integrations/*` - OpenAI, MCP, GitHub integrations
- `src/files.ts` - storage facade/barrel; keep exports coherent

You MUST place new code in the correct layer. Do not collapse domain logic into CLI handlers.

---

## 5) CLI Contract Rules (Do Not Break)

Primary commands:
- `digest`
- `merge`
- `report`
- `import`

Global flags are parsed once and apply across commands:
- `--verbose`
- `--dry-run`
- `--config <file>`

Key invariants:
- `report --period` defaults to `weekly`.
- `import --server` accepts only `github` or `mcp.<name>`.
- Bare MCP names (example: `--server slack`) are invalid by design.
- Import mode requires exactly one of:
  - `--list-actions`
  - `--tool <name>` (with optional `--args <json>`, `--output <file>`)
- `merge` supports `--auto-merge`; without it, confirmation prompt is required.

If you alter argument behavior, you MUST update:
- `src/cli/args.ts`
- CLI orchestration in `src/cli.ts`
- tests in `tests/cli.test.ts`
- README command docs

---

## 6) Data and Markdown Contracts

Digest note files (`notes/*.md`) MUST include:
- YAML frontmatter (`category`, `source`, `merged`, `input_raw`, `merged_topic_paths`)
- Sections:
  - `## Summary`
  - `## Key Points`
  - `## Timeline`
  - `## References`

Topic files (`topics/<category>/*.md`) are category-specific canonical documents.
Do not mix category section schemas.

Report files (`reports/*.md`) MUST preserve frontmatter metadata:
- `period`
- `generated_at`
- `model`
- `input_files`
- `base_reports`

Formatting contracts:
- Timeline entries: `YYYY-MM-DD - <context>`
- Reference lines: `- <source>: <link>`
- Digest human-readable output is always in English.

---

## 7) AI / Prompting Framework Rules

Prompt registry operations are required:
- `digest`
- `merge`
- `merge_content`
- `report`

Every operation MUST:
- build prompt messages,
- define `responseFormat.type = "json_schema"`,
- use strict schema validation.

Runtime behavior:
- Missing/unsupported structured output must fail fast with explicit error.
- `--dry-run` MUST print request preview and MUST NOT call network.
- Verbose mode may log full prompts/responses; treat as sensitive.

If you change schemas/parsers/prompts, update all three surfaces:
1. schema (`src/domain/*/schemas.ts` or equivalent),
2. parser/validation,
3. tests covering happy and failure paths.

---

## 8) Testing Standards (Mandatory)

Framework:
- `bun:test` only.

General rules:
- Add or update tests for every functional change.
- Prefer targeted suites first, then run full `bun run check`.
- Do not rely on network in tests.
- Stub `fetch` for OpenAI tests.
- Use temp directories for storage tests and clean up (`mkdtemp` + `rm`).

Minimum regression coverage by area:
- CLI args/orchestration: `tests/cli.test.ts`
- Digest/merge schemas/parsers/rendering: `tests/digest.test.ts`
- Report generation/format: `tests/report.test.ts`
- Storage/read-write behavior: `tests/files.test.ts`
- Config resolution: `tests/config.test.ts`
- GitHub import + transforms: `tests/import.test.ts`
- OpenAI integration and dry-run: `tests/openai.test.ts`

Do not merge changes that only pass a subset unless task explicitly limits scope.

---

## 9) Lint, Format, and Code Style Constraints

- TypeScript strict mode is active; keep types explicit at boundaries.
- Use path alias `$/*` for `src/*` imports where appropriate.
- Keep module APIs small and composable.
- Prefer pure functions in `domain/`; isolate side effects in `storage/` and `integrations/`.
- Do not add comments for obvious code.
- Avoid introducing non-ASCII unless file already requires it.
- Keep naming consistent with existing vocabulary (`digest`, `topic`, `report`, `import`, `allowedSources`).

Pre-commit hooks currently run:
1. `bunx lint-staged` (Biome write/check on staged files)
2. `bun run typecheck`

Do not bypass hooks.

---

## 10) Dependency and API Policy

Before adding a dependency, agent MUST verify:
1. Bun or Node stdlib cannot solve it,
2. no existing module already solves it,
3. test and maintenance burden is justified.

Prefer:
- Bun runtime APIs
- Node built-ins already in use
- existing internal utilities

Avoid:
- introducing Express/Vite/Jest/Vitest/dotenv for this CLI project
- parallel duplicate libraries for existing concerns (formatting, linting, testing)

---

## 11) Config and Environment Conventions

Project config discovery:
- Default: `<cwd>/proma.config.ts`
- Fallbacks: `.mjs`, `.js` (auto-discovery path order in `core/config.ts`)
- `--config <file>` with missing file MUST fail when explicitly provided.

Supported config shape:
- `digest.allowedSources: string[]`
- `github.host?: string`
- `mcp.<serverName>: { type: "local"; command: string[] }`

Rules:
- `allowedSources` are normalized lowercase + deduped + unioned with defaults.
- MCP server names are case-sensitive.
- GitHub host, when set, routes through `gh api --hostname`.

---

## 12) Dry-Run and Logging Guarantees

Dry run means:
- NO file writes
- NO log file writes
- NO network/AI calls
- ONLY preview output

Logging:
- Normal mode writes JSONL to `logs/<YYYY-MM-DD>/...`.
- Verbose mode includes detailed debug logs and may include prompt/response payloads.
- Treat logs as potentially sensitive operational artifacts.

Never weaken dry-run semantics.

---

## 13) Git, PR, and Release Standards

Follow `GIT_WORKFLOW.md` exactly.

Branching model:
- long-lived: `main`, `develop`
- short-lived: `feature/*`, `bugfix/*`, `hotfix/*`, `release/*`

Commit messages:
- Conventional Commits required.
- Feature/bugfix automation convention may include ticket prefix: `feat: [Txxx] ...`

PR quality gate (minimum):
1. `bun run check` passes
2. behavior-changing docs updated (`README.md` and/or docs)
3. tests added/updated
4. scope is focused and reviewable

Release workflow:
- Release bookkeeping only on `release/vX.Y.Z` branches.
- Update `package.json` version.
- Create frozen release record `docs/releases/vX.Y.Z.md`.
- Consolidate/delete completed `docs/tickets/T*.md` (keep `TEMPLATE.md`).
- No app code changes during release preparation.

---

## 14) Documentation and Automation Conventions

When behavior changes, update docs in same change set:
- CLI flags/flows: `README.md`
- Process changes: `GIT_WORKFLOW.md` (only when process truly changes)
- Release summaries: `docs/releases/*`

Ticket docs:
- New/updated tickets MUST follow `docs/tickets/TEMPLATE.md` frontmatter and section structure.

OpenCode automation commands:
- `.opencode/commands/*.md` must include frontmatter:
  - `description`
  - `agent`
- Command content MUST be prescriptive and repo-specific, not generic.

---

## 15) Known Pitfalls and Edge Cases

- `--config` path resolves from current working directory, not `--project`.
- `import` defaults to stdout unless `--output` is provided.
- `merge` skips digest-note merge-marking when user rejects preview.
- Re-processing already merged references may be a no-op (`No topic change`) by design.
- Topic routing narrows to top-ranked candidates; avoid introducing nondeterministic ranking.
- Models without structured outputs must error clearly; do not silently fallback to unstructured text parsing.
- Verbose logs can expose prompt content; avoid using real secrets in test fixtures.
- Keep `index.ts` and `src/files.ts` exports synchronized with actual public API expectations.

---

## 16) Agent Execution Checklist (Per Task)

Before coding:
1. Read relevant layer files and existing tests.
2. Identify contract surfaces impacted (CLI args, schemas, markdown, config).
3. Plan test updates first.

During coding:
1. Keep changes minimal and layer-correct.
2. Preserve deterministic behavior.
3. Update docs inline with behavior changes.

Before finishing:
1. Run targeted tests.
2. Run `bun run check`.
3. Verify no dry-run regressions.
4. Provide concise change summary with touched paths and risk notes.

This checklist is mandatory for autonomous edits.
