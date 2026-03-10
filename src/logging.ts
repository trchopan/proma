import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

export type LogLevel = "progress" | "info" | "debug" | "error";

export type LogEvent = {
  ts: string;
  level: LogLevel;
  runId: string;
  command: string;
  event: string;
  message: string;
  meta?: Record<string, unknown>;
};

export type Logger = {
  verbose: boolean;
  runId: string;
  logFilePath: string;
  progress: (
    event: string,
    message: string,
    meta?: Record<string, unknown>,
  ) => Promise<void>;
  info: (
    event: string,
    message: string,
    meta?: Record<string, unknown>,
  ) => Promise<void>;
  debug: (
    event: string,
    message: string,
    meta?: Record<string, unknown>,
  ) => Promise<void>;
  error: (
    event: string,
    message: string,
    meta?: Record<string, unknown>,
  ) => Promise<void>;
};

type CreateLoggerOptions = {
  command: string;
  verbose: boolean;
  dryRun?: boolean;
  out: (message: string) => void;
  err: (message: string) => void;
  logsRoot?: string;
  now?: Date;
};

function safeTimestamp(now: Date): string {
  return now.toISOString().replace(/[:.]/g, "-");
}

function buildRunId(now: Date): string {
  return `${safeTimestamp(now)}-${process.pid}`;
}

export async function createLogger(
  options: CreateLoggerOptions,
): Promise<Logger> {
  const now = options.now ?? new Date();
  const dateDir = now.toISOString().slice(0, 10);
  const root = options.logsRoot ?? path.resolve(process.cwd(), "logs");
  const directory = path.join(root, dateDir);
  const runId = buildRunId(now);
  const fileName = `${safeTimestamp(now)}_${options.command}_${process.pid}.jsonl`;
  const logFilePath = path.join(directory, fileName);

  if (!options.dryRun) {
    await mkdir(directory, { recursive: true });
  }

  async function write(
    level: LogLevel,
    event: string,
    message: string,
    meta?: Record<string, unknown>,
  ): Promise<void> {
    if (level === "debug" && !options.verbose) {
      return;
    }

    const payload: LogEvent = {
      ts: new Date().toISOString(),
      level,
      runId,
      command: options.command,
      event,
      message,
      meta,
    };

    if (level === "progress") {
      options.out(message);
    } else if (level === "error") {
      options.err(message);
    } else if (options.verbose) {
      options.out(message);
    }

    if (!options.dryRun) {
      await appendFile(logFilePath, `${JSON.stringify(payload)}\n`, "utf8");
    }
  }

  return {
    verbose: options.verbose,
    runId,
    logFilePath,
    progress: (event, message, meta) => write("progress", event, message, meta),
    info: (event, message, meta) => write("info", event, message, meta),
    debug: (event, message, meta) => write("debug", event, message, meta),
    error: (event, message, meta) => write("error", event, message, meta),
  };
}
