import { DEFAULT_MODEL } from "../config";
import { REPORT_PERIODS, type ReportPeriod } from "../report";

type ParsedOptions = {
  values: Map<string, string[]>;
  flags: Set<string>;
};

type OptionConfig = {
  valueOptions: Set<string>;
  flagOptions: Set<string>;
  repeatableOptions?: Set<string>;
};

export type DigestArgs = {
  input: string;
  project: string;
  model: string;
  verbose: boolean;
  dryRun: boolean;
};

export type MergeArgs = {
  project: string;
  model: string;
  verbose: boolean;
  dryRun: boolean;
  autoMerge: boolean;
};

export type ReportArgs = {
  project: string;
  period: ReportPeriod;
  input: string[];
  base: string[];
  model: string;
  verbose: boolean;
  dryRun: boolean;
};

const DEFAULT_REPORT_PERIOD: ReportPeriod = "weekly";

function parseOptionValues(
  args: string[],
  config: OptionConfig,
): ParsedOptions {
  const values = new Map<string, string[]>();
  const flags = new Set<string>();
  const repeatableOptions = config.repeatableOptions ?? new Set<string>();

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i] ?? "";
    if (!arg.startsWith("--")) {
      continue;
    }

    if (config.flagOptions.has(arg)) {
      flags.add(arg);
      continue;
    }

    if (!config.valueOptions.has(arg)) {
      throw new Error(`Unknown argument: ${arg}`);
    }

    const value = args[i + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for ${arg}`);
    }

    const current = values.get(arg) ?? [];
    if (current.length > 0 && !repeatableOptions.has(arg)) {
      throw new Error(`Duplicate argument: ${arg}`);
    }

    current.push(value);
    values.set(arg, current);
    i += 1;
  }

  return { values, flags };
}

export function parseDigestCommandArgs(args: string[]): DigestArgs {
  const { values, flags } = parseOptionValues(args, {
    valueOptions: new Set(["--input", "--project", "--model"]),
    flagOptions: new Set(["--verbose", "--dry-run"]),
  });
  const input = values.get("--input")?.[0];
  const project = values.get("--project")?.[0];
  const model = values.get("--model")?.[0] ?? DEFAULT_MODEL;
  const verbose = flags.has("--verbose");
  const dryRun = flags.has("--dry-run");

  if (!input) {
    throw new Error("Missing required argument: --input");
  }

  if (!project) {
    throw new Error("Missing required argument: --project");
  }

  return { input, project, model, verbose, dryRun };
}

export function parseMergeCommandArgs(args: string[]): MergeArgs {
  const { values, flags } = parseOptionValues(args, {
    valueOptions: new Set(["--project", "--model"]),
    flagOptions: new Set(["--verbose", "--dry-run", "--auto-merge"]),
  });
  const project = values.get("--project")?.[0];
  const model = values.get("--model")?.[0] ?? DEFAULT_MODEL;
  const verbose = flags.has("--verbose");
  const dryRun = flags.has("--dry-run");
  const autoMerge = flags.has("--auto-merge");

  if (!project) {
    throw new Error("Missing required argument: --project");
  }

  return { project, model, verbose, dryRun, autoMerge };
}

export function parseReportCommandArgs(args: string[]): ReportArgs {
  const { values, flags } = parseOptionValues(args, {
    valueOptions: new Set([
      "--project",
      "--period",
      "--input",
      "--base",
      "--model",
    ]),
    flagOptions: new Set(["--verbose", "--dry-run"]),
    repeatableOptions: new Set(["--input", "--base"]),
  });

  const project = values.get("--project")?.[0];
  const periodValue =
    values.get("--period")?.[0]?.trim().toLowerCase() ?? DEFAULT_REPORT_PERIOD;
  const model = values.get("--model")?.[0] ?? DEFAULT_MODEL;
  const input = values.get("--input") ?? [];
  const base = values.get("--base") ?? [];
  const verbose = flags.has("--verbose");
  const dryRun = flags.has("--dry-run");

  if (!project) {
    throw new Error("Missing required argument: --project");
  }

  if (!(REPORT_PERIODS as readonly string[]).includes(periodValue)) {
    throw new Error(
      `Invalid --period value: ${periodValue} (expected one of: ${REPORT_PERIODS.join(", ")})`,
    );
  }

  return {
    project,
    period: periodValue as ReportPeriod,
    input,
    base,
    model,
    verbose,
    dryRun,
  };
}
