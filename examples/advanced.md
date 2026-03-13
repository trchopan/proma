# Advanced Example: End-to-End Operational Knowledge Pipeline

Use this for real-world, recurring project operations with full Proma capabilities.

## Scenario

Your team collects updates from GitHub and MCP tools, applies source policy, validates changes with dry runs, then publishes monthly summaries.

## 1) Configure project behavior

Create `proma.config.ts`:

```ts
export default {
  digest: {
    allowedSources: ["jira", "notion"],
  },
  github: {
    host: "git.example.com",
  },
  mcp: {
    slack: {
      type: "local",
      command: ["bun", "./scripts/slack-mcp.ts"],
    },
  },
};
```

## 2) Discover import actions

```bash
proma import --server github --list-actions
proma import --server mcp.slack --list-actions
```

## 3) Import from multiple systems

```bash
proma import --server github --tool issue_get --args '{"owner":"acme","repo":"platform","number":120}' > ./acme/imports/2026-03-13_github_issue-get.md
proma import --server mcp.slack --tool fetch_thread --args '{"channel":"C123","thread_ts":"1710.123"}' > ./acme/imports/2026-03-13_mcp-slack_fetch-thread.md
```

## 4) Dry-run before writes

```bash
proma digest --project ./acme --input ./acme/imports/2026-03-13_github_issue-get.md --dry-run
proma merge --project ./acme --dry-run
proma report --project ./acme --period monthly --dry-run
```

## 5) Execute pipeline for production artifacts

```bash
proma digest --project ./acme --input ./acme/imports/2026-03-13_github_issue-get.md
proma digest --project ./acme --input ./acme/imports/2026-03-13_mcp-slack_fetch-thread.md
proma merge --project ./acme --auto-merge
proma report --project ./acme --period monthly --input ./acme/topics/planning/release-readiness.md --input ./acme/topics/discussion/incident-response.md --base ./acme/reports/2026-02-01_monthly.md
```

## 6) Audit and operations checks

- Review generated files under `acme/imports/`, `acme/notes/`, `acme/topics/`, and `acme/reports/`.
- Inspect run logs in `logs/<YYYY-MM-DD>/*.jsonl`.
- Re-running `merge` on already-merged references should trend toward no-op changes.

## Why this is useful

- Covers full ingestion-to-report lifecycle.
- Supports safe operation with dry runs and deterministic artifacts.
- Fits real team rituals: daily ingestion, continuous curation, periodic reporting.
