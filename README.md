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

The `digest` command reads an input text file, asks OpenAI to split/classify it into digest items, and writes markdown files by category.
Digest summaries and key points are always generated in English, even when input notes are in another language.

Required environment variable:

```bash
export OPENAI_API_KEY="your_api_key"
```

Run the command:

```bash
bun run index.ts digest --input ./notes.txt --project ./acme
```

Optional model override:

```bash
bun run index.ts digest --input ./notes.txt --project ./acme --model gpt-4.1-mini
```

Note: the digest flow uses OpenAI Structured Outputs (`json_schema`) and fails fast if the selected model does not support it.

`--project` is the root output directory. Output structure:

- `<project>/planning/<YYYY-MM-DD>_<index>.md`
- `<project>/research/<YYYY-MM-DD>_<index>.md`
- `<project>/discussion/<YYYY-MM-DD>_<index>.md`

Each generated markdown file includes:

- `## Summary`
- `## Key Points`
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
