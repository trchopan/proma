---
description: Release a minor version, including release notes and tagging.
agent: plan
---

Objective

Prepare a minor release from a clean, fully merged `develop` branch.

All release operations must strictly follow the rules defined in: `GIT_WORKFLOW.md`.

Do not redefine workflow rules.
Follow the documented release flow, merge strategy, tagging rules,
and guardrails exactly as written there.

This release must:

1. Determine the current SemVer version.
2. Increment the MINOR version (reset PATCH to 0).
3. Create a consolidated frozen release record.
4. Delete completed ticket files from `docs/tickets/` (keep `TEMPLATE.md`).
5. Open a PR from `develop` to `main`.
6. Tag the merge commit after PR approval.

Do NOT modify:

- Application code
- Files under `docs/spec/`
- GIT_WORKFLOW.md

Only perform release bookkeeping work.

---

Version Determination

Determine current version according to repository state:

- Prefer latest git tag matching `v<MAJOR>.<MINOR>.<PATCH>`
- If none exists, assume starting version `v0.1.0`

Increment MINOR:

Example:
v1.4.3 → v1.5.0
v0.1.0 → v0.2.0

Let:
<new_version> = v<MAJOR>.<MINOR+1>.0

All branching and tagging must use this version.

---

Release Branch

Create the release branch exactly as described in GIT_WORKFLOW.md:

release/<new_version>

Allowed changes are limited to what GIT_WORKFLOW.md permits
during release preparation.

No feature or bugfix work is allowed.

---

Release Record

Create:

docs/releases/<new_version>.md

Header must include:

# Release <new_version>

This release record is frozen. Amendments must be added as:
docs/releases/<new_version>-amendment.md.

Branch: develop
Version: <new_version>
Release Date: <today>

---

Ticket Consolidation

Process all ticket files in:

docs/tickets/T\*.md

For each ticket extract:

- Title
- Goal (condensed)
- Acceptance (condensed)
- Canonical spec references
- Dependencies (human-readable, no ticket IDs)
- Disposition (assume done unless clearly superseded)

Do NOT include numeric ticket IDs in the release document.
Do NOT include commit SHAs.
Do NOT include implementation evidence.

Group entries logically by system area inferred from content.

---

Backlog Cleanup

After generating the release record:

- Delete all ticket files under `docs/tickets/T*.md`
- Keep `docs/tickets/TEMPLATE.md` in place
- Leave the tickets directory present
- Do not create new backlog tickets

List deleted files before committing.

---

Commit

Create exactly one commit for release preparation:

chore(release): prepare <new_version>

Commit must follow Conventional Commits as defined in GIT_WORKFLOW.md.

---

PR and Tagging

Follow the release flow exactly as documented in GIT_WORKFLOW.md:

- Merge release branch back into `develop`
- Open PR: develop → main
- After PR merge, create annotated tag:
  v<new_version>

Do not invent alternative flow.

---

Deliverables

Provide:

1. Determined current version and computed <new_version>
2. Full contents of docs/releases/<new_version>.md
3. List of deleted tickets files
4. Exact git command sequence executed according to GIT_WORKFLOW.md
5. PR title and body text
