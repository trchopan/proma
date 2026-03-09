import { DEFAULT_MODEL } from "../config";

type ParsedOptions = {
  values: Map<string, string>;
  flags: Set<string>;
};

export type DigestArgs = {
  input: string;
  project: string;
  model: string;
  verbose: boolean;
};

export type MergeArgs = {
  project: string;
  model: string;
  verbose: boolean;
};

function parseOptionValues(args: string[]): ParsedOptions {
  const values = new Map<string, string>();
  const flags = new Set<string>();
  const valueOptions = new Set(["--input", "--project", "--model"]);
  const flagOptions = new Set(["--verbose"]);

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i] ?? "";
    if (!arg.startsWith("--")) {
      continue;
    }

    if (flagOptions.has(arg)) {
      flags.add(arg);
      continue;
    }

    if (!valueOptions.has(arg)) {
      throw new Error(`Unknown argument: ${arg}`);
    }

    const value = args[i + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for ${arg}`);
    }

    values.set(arg, value);
    i += 1;
  }

  return { values, flags };
}

export function parseDigestCommandArgs(args: string[]): DigestArgs {
  const { values, flags } = parseOptionValues(args);
  const input = values.get("--input");
  const project = values.get("--project");
  const model = values.get("--model") ?? DEFAULT_MODEL;
  const verbose = flags.has("--verbose");

  if (!input) {
    throw new Error("Missing required argument: --input");
  }

  if (!project) {
    throw new Error("Missing required argument: --project");
  }

  return { input, project, model, verbose };
}

export function parseMergeCommandArgs(args: string[]): MergeArgs {
  const { values, flags } = parseOptionValues(args);
  const project = values.get("--project");
  const model = values.get("--model") ?? DEFAULT_MODEL;
  const verbose = flags.has("--verbose");

  if (!project) {
    throw new Error("Missing required argument: --project");
  }

  return { project, model, verbose };
}
