# proma

To install dependencies:

```bash
bun install
```

To run:

```bash
bun run index.ts
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

Git hook:

```bash
# installed automatically on bun install via "prepare"
# pre-commit runs lint-staged + typecheck
```

This project was created using `bun init` in bun v1.3.9. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.
