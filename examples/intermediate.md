# Intermediate Example: Team Collaboration Flow

Use this when multiple teammates collaborate on project updates.

## Scenario

- User A imports external updates and digests them.
- User B reviews merge diffs and approves topic changes.
- User C generates the weekly report for stakeholders.

## Step 1: User A imports and digests

```bash
proma import --server github --tool prs_list --args '{"owner":"acme","repo":"platform","author":"alice","state":"all","per_page":20,"page":1}' > ./acme/imports/2026-03-13_github_prs-list.md
proma digest --project ./acme --input ./acme/imports/2026-03-13_github_prs-list.md
```

Output from this stage:

- Imported markdown saved by user in `acme/imports/`
- Pending digest notes in `acme/notes/`

## Step 2: User B reviews and merges

```bash
proma merge --project ./acme
```

During this step:

- Proma shows a diff preview per topic.
- User B can approve only relevant merges (`y`) and skip noisy ones (default `N`).

## Step 3: User C publishes report

```bash
proma report --project ./acme --period weekly
```

## Collaboration pattern

- A can run import/digest daily.
- B can run merge at end-of-day for curation.
- C can run report weekly for leadership updates.

## Why this is useful

- Separates ingestion, review, and reporting responsibilities.
- Keeps topic history curated while still moving fast.
