import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";

const DEFAULT_REQUEST_TIMEOUT_MS = 20_000;

type JsonRpcRequest = {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: Record<string, unknown>;
};

type JsonRpcNotification = {
  jsonrpc: "2.0";
  method: string;
  params?: Record<string, unknown>;
};

type JsonRpcError = {
  code?: number;
  message?: string;
  data?: unknown;
};

type JsonRpcResponse = {
  jsonrpc?: string;
  id?: number;
  result?: unknown;
  error?: JsonRpcError;
};

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: Timer;
};

export type McpLocalServerRuntime = {
  command: string[];
};

export type McpTool = {
  name: string;
  description?: string;
  inputSchema?: unknown;
};

type ListToolsResult = {
  tools?: Array<{
    name?: unknown;
    description?: unknown;
    inputSchema?: unknown;
    input_schema?: unknown;
  }>;
};

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

class LocalMcpSession {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly pending = new Map<number, PendingRequest>();
  private readonly stderrChunks: string[] = [];
  private nextId = 1;
  private stdoutBuffer = "";
  private isClosed = false;

  constructor(
    command: string[],
    private readonly timeoutMs: number,
  ) {
    const executable = command[0];
    if (!executable) {
      throw new Error("Invalid MCP command: missing executable");
    }

    this.child = spawn(executable, command.slice(1), {
      stdio: ["pipe", "pipe", "pipe"],
    });

    this.child.stdout.setEncoding("utf8");
    this.child.stderr.setEncoding("utf8");

    this.child.stdout.on("data", (chunk: string) => {
      this.stdoutBuffer += chunk;
      this.consumeStdoutBuffer();
    });

    this.child.stderr.on("data", (chunk: string) => {
      this.stderrChunks.push(chunk);
      if (this.stderrChunks.length > 10) {
        this.stderrChunks.shift();
      }
    });

    this.child.on("error", (error) => {
      this.rejectAll(
        new Error(
          `Failed to start MCP server process: ${toErrorMessage(error)}`,
        ),
      );
    });

    this.child.on("close", (code, signal) => {
      this.isClosed = true;
      if (this.pending.size > 0) {
        const details = this.getStderrSummary();
        this.rejectAll(
          new Error(
            `MCP server process exited before responding (code=${code ?? "null"}, signal=${signal ?? "null"})${details}`,
          ),
        );
      }
    });
  }

  async initialize(): Promise<void> {
    await this.request("initialize", {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: {
        name: "proma",
        version: "0.1.0",
      },
    });
    this.notify("notifications/initialized");
  }

  async request(
    method: string,
    params?: Record<string, unknown>,
  ): Promise<unknown> {
    if (this.isClosed) {
      throw new Error("MCP session is already closed");
    }

    const id = this.nextId;
    this.nextId += 1;

    const request: JsonRpcRequest = {
      jsonrpc: "2.0",
      id,
      method,
      params,
    };

    return new Promise<unknown>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new Error(
            `MCP request timed out after ${this.timeoutMs}ms: ${method}${this.getStderrSummary()}`,
          ),
        );
      }, this.timeoutMs);

      this.pending.set(id, { resolve, reject, timeout });

      try {
        this.child.stdin.write(`${JSON.stringify(request)}\n`);
      } catch (error) {
        clearTimeout(timeout);
        this.pending.delete(id);
        reject(
          new Error(
            `Failed to write MCP request '${method}': ${toErrorMessage(error)}`,
          ),
        );
      }
    });
  }

  notify(method: string, params?: Record<string, unknown>): void {
    if (this.isClosed) {
      return;
    }

    const notification: JsonRpcNotification = {
      jsonrpc: "2.0",
      method,
      params,
    };
    this.child.stdin.write(`${JSON.stringify(notification)}\n`);
  }

  async close(): Promise<void> {
    if (!this.isClosed) {
      try {
        await this.request("shutdown");
      } catch {
        // Ignore shutdown errors; process may already be exiting.
      }
      this.notify("exit");
      this.child.stdin.end();
    }

    await new Promise<void>((resolve) => {
      if (this.isClosed) {
        resolve();
        return;
      }

      const timer = setTimeout(() => {
        this.child.kill();
        resolve();
      }, 500);

      this.child.once("close", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  private getStderrSummary(): string {
    const merged = this.stderrChunks.join("").trim();
    if (!merged) {
      return "";
    }

    return `; stderr: ${merged.slice(-400)}`;
  }

  private consumeStdoutBuffer(): void {
    while (this.stdoutBuffer.length > 0) {
      const headerMatch = this.stdoutBuffer.match(
        /^Content-Length:\s*(\d+)\r?\n(?:[^\r\n]*\r?\n)*\r?\n/i,
      );

      if (headerMatch?.[0]) {
        const payloadLength = Number.parseInt(headerMatch[1] ?? "0", 10);
        const headerLength = headerMatch[0].length;
        if (this.stdoutBuffer.length < headerLength + payloadLength) {
          return;
        }

        const payload = this.stdoutBuffer.slice(
          headerLength,
          headerLength + payloadLength,
        );
        this.stdoutBuffer = this.stdoutBuffer.slice(
          headerLength + payloadLength,
        );
        this.handlePayload(payload);
        continue;
      }

      const newlineIndex = this.stdoutBuffer.indexOf("\n");
      if (newlineIndex < 0) {
        return;
      }

      const line = this.stdoutBuffer.slice(0, newlineIndex).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(newlineIndex + 1);
      if (line.length === 0) {
        continue;
      }
      this.handlePayload(line);
    }
  }

  private handlePayload(payload: string): void {
    let parsed: JsonRpcResponse;
    try {
      parsed = JSON.parse(payload) as JsonRpcResponse;
    } catch {
      return;
    }

    const id = parsed.id;
    if (typeof id !== "number") {
      return;
    }

    const pending = this.pending.get(id);
    if (!pending) {
      return;
    }

    clearTimeout(pending.timeout);
    this.pending.delete(id);

    if (parsed.error) {
      pending.reject(
        new Error(
          `MCP request failed: ${parsed.error.message ?? "Unknown JSON-RPC error"}`,
        ),
      );
      return;
    }

    pending.resolve(parsed.result);
  }

  private rejectAll(error: Error): void {
    for (const [id, pending] of this.pending.entries()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
      this.pending.delete(id);
    }
  }
}

async function withSession<T>(
  server: McpLocalServerRuntime,
  timeoutMs: number,
  fn: (session: LocalMcpSession) => Promise<T>,
): Promise<T> {
  const session = new LocalMcpSession(server.command, timeoutMs);
  try {
    await session.initialize();
    return await fn(session);
  } finally {
    await session.close();
  }
}

export async function listMcpTools(options: {
  server: McpLocalServerRuntime;
  timeoutMs?: number;
}): Promise<McpTool[]> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  return withSession(options.server, timeoutMs, async (session) => {
    const result = (await session.request("tools/list", {})) as ListToolsResult;
    const tools = result.tools ?? [];
    const normalized: McpTool[] = [];

    for (const tool of tools) {
      const name = typeof tool.name === "string" ? tool.name.trim() : "";
      if (!name) {
        continue;
      }

      normalized.push({
        name,
        description:
          typeof tool.description === "string" ? tool.description : undefined,
        inputSchema: tool.inputSchema ?? tool.input_schema,
      });
    }

    return normalized;
  });
}

export async function callMcpTool(options: {
  server: McpLocalServerRuntime;
  tool: string;
  args: Record<string, unknown>;
  timeoutMs?: number;
}): Promise<unknown> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  return withSession(options.server, timeoutMs, async (session) => {
    return session.request("tools/call", {
      name: options.tool,
      arguments: options.args,
    });
  });
}
