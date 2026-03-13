# Git Workflow

This document defines how we branch, commit, review, and release code in this repository.

## 1) Branching model

We use a lightweight Git Flow model:

- `main`: production-ready code only
- `develop`: integration branch for completed features and fixes

Short-lived branches:

- `feature/<ticket>-<short-name>`
- `bugfix/<ticket>-<short-name>`
- `hotfix/<short-name>`
- `release/v<major>.<minor>.<patch>`

Examples:

- `feature/123-user-auth`
- `bugfix/456-fix-expired-token`
- `hotfix/login-crash`
- `release/v1.3.0`

## 2) Branch naming rules

Format:

```text
<type>/<optional-ticket>-<description>
```

Rules:

- lowercase only
- kebab-case only
- keep names short and explicit

## 3) Daily development flow

Start work:

```bash
git checkout develop
git pull origin develop
git checkout -b feature/123-some-work
```

During work:

- make small, atomic commits
- keep branch rebased or updated from `develop`

Finish work:

```bash
git push -u origin feature/123-some-work
```

Open a PR into `develop`.

## 4) Hotfix flow

Use hotfix only for production incidents.

```bash
git checkout main
git pull origin main
git checkout -b hotfix/critical-fix
```

After merge:

1. Merge into `main`
2. Tag if appropriate
3. Merge back into `develop`

Hotfix branches use **Merge Commit** strategy.

## 5) Release flow

We release from a clean, fully merged `develop` branch.

All features and fixes must already be merged into `develop` before starting release.

We follow SemVer: `MAJOR.MINOR.PATCH`.

Minor release example:

- `v1.4.3` → `v1.5.0`

### 5.1 Prepare release bookkeeping branch

Create a release branch from `develop`:

```bash
git checkout develop
git pull origin develop
git checkout -b release/v1.5.0
```

Allowed changes on the release branch:

- Create release record:
    - `docs/releases/v<major>.<minor>.<patch>.md`

- Update `package.json` version to the release SemVer (without `v` prefix)
- Consolidate and delete completed backlog tickets from `docs/tickets/`
- Documentation-only adjustments related to the release

Not allowed on the release branch:

- Application code changes
- Database schema changes
- Modifications under `docs/spec/`

Commit:

```bash
git commit -m "chore(release): prepare v1.5.0"
```

Merge release branch back into `develop`:

```bash
git checkout develop
git merge --no-ff release/v1.5.0
git push origin develop
```

Release branches use **Merge Commit** strategy.

### 5.2 Open release PR

Open a Pull Request:

- Source: `develop`
- Target: `main`
- Title: `chore(release): v1.5.0`

Release PR must include:

- Short summary of system-level changes
- Link to `docs/releases/v1.5.0.md`
- Confirmation that tests pass

No feature work should be added at this stage.

### 5.3 Tag after merge

After the PR is merged into `main`, tag the merge commit:

```bash
git checkout main
git pull origin main
git tag -a v1.5.0 -m "Release v1.5.0"
git push origin v1.5.0
```

Tags must be annotated.

## 6) Backlog consolidation policy

After each release:

- All completed tickets in `docs/tickets/` are consolidated into:
    - `docs/releases/v<major>.<minor>.<patch>.md`

- Ticket files are deleted from `docs/tickets/` (except `TEMPLATE.md`)
- The tickets folder remains present
- The release record is frozen

If corrections are required later, create:

```
docs/releases/v<version>-amendment.md
```

Do not modify historical release records directly.

## 7) Commit conventions

We use Conventional Commits:

```text
<type>: <summary>
```

Common types:

- `feat`
- `fix`
- `docs`
- `refactor`
- `test`
- `chore`

Examples:

- `feat: add order filtering by status`
- `fix: handle nil token in auth plug`
- `docs: document local setup for Phoenix`
- `chore(release): prepare v1.5.0`

Backlog automation convention:

```text
feat: [Txxx] <summary>
```

This applies only to feature/bugfix PRs into `develop`.

Release PRs must NOT reference ticket IDs.

## 8) Merge strategy

- `feature/*` and `bugfix/*`: Squash and Merge into `develop`
- `release/*`: Merge Commit into `develop`
- `hotfix/*`: Merge Commit into `main`, then merge back into `develop`

Never rebase shared branches.

## 9) Versioning and tags

We follow SemVer:

```
MAJOR.MINOR.PATCH
```

Rules:

- MAJOR: breaking changes
- MINOR: backward-compatible features
- PATCH: backward-compatible fixes

Tagging example:

```bash
git tag -a v1.5.0 -m "Release v1.5.0"
git push origin v1.5.0
```

Tags must always be annotated.

## 10) Guardrails

- never push directly to `main`
- avoid force-push on shared branches
- keep PRs focused and small
- update documentation when behavior changes
- do not modify spec files during release preparation
- do not modify application code during release preparation
- if needed, split large changes into multiple PRs
- ensure CI and `mix precommit` pass before merge
