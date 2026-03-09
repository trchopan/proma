import path from "node:path";

import { generateDigestItems } from "./digest";
import { writeDigestItems } from "./files";

type CliDependencies = {
  generateDigestItems: typeof generateDigestItems;
  writeDigestItems: typeof writeDigestItems;
  readTextFile: (filePath: string) => Promise<string>;
};

type CliIO = {
  out: (message: string) => void;
  err: (message: string) => void;
};

type DigestArgs = {
  input: string;
  project: string;
  model: string;
};

const DEFAULT_MODEL = "gpt-5.2";

function defaultReadTextFile(filePath: string): Promise<string> {
  return Bun.file(filePath).text();
}

function usage(): string {
  return "Usage: bun run index.ts digest --input <file> --project <output-root> [--model <model>]";
}

export function parseDigestCommandArgs(args: string[]): DigestArgs {
  const values = new Map<string, string>();

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i] ?? "";
    if (!arg.startsWith("--")) {
      continue;
    }

    const value = args[i + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for ${arg}`);
    }

    values.set(arg, value);
    i += 1;
  }

  const input = values.get("--input");
  const project = values.get("--project");
  const model = values.get("--model") ?? DEFAULT_MODEL;

  if (!input) {
    throw new Error("Missing required argument: --input");
  }

  if (!project) {
    throw new Error("Missing required argument: --project");
  }

  return { input, project, model };
}

export async function runCli(
  argv: string[],
  dependencies: Partial<CliDependencies> = {},
  io: Partial<CliIO> = {},
): Promise<number> {
  const deps: CliDependencies = {
    generateDigestItems,
    writeDigestItems,
    readTextFile: defaultReadTextFile,
    ...dependencies,
  };
  const terminal: CliIO = {
    out: console.log,
    err: console.error,
    ...io,
  };

  if (argv[0] !== "digest") {
    terminal.err(`Unknown command: ${argv[0] ?? "(none)"}`);
    terminal.err(usage());
    return 1;
  }

  try {
    const parsed = parseDigestCommandArgs(argv.slice(1));
    const inputPath = path.resolve(parsed.input);
    const projectRoot = path.resolve(parsed.project);
    const inputText = await deps.readTextFile(inputPath);
    const items = await deps.generateDigestItems(inputText, {
      model: parsed.model,
    });
    const writtenFiles = await deps.writeDigestItems({
      projectRoot,
      items,
    });

    terminal.out(`Wrote ${writtenFiles.length} digest file(s):`);
    for (const writtenPath of writtenFiles) {
      terminal.out(`- ${writtenPath}`);
    }

    return 0;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown CLI error";
    terminal.err(`Error: ${message}`);
    terminal.err(usage());
    return 1;
  }
}
