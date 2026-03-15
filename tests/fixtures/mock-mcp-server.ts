type JsonRpcRequest = {
  id?: number;
  method?: string;
  params?: Record<string, unknown>;
};

function respond(id: number, result: unknown): void {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`);
}

function handleRequest(request: JsonRpcRequest): void {
  if (typeof request.id !== "number") {
    if (request.method === "exit") {
      process.exit(0);
    }
    return;
  }

  if (request.method === "initialize") {
    respond(request.id, { capabilities: {} });
    return;
  }

  if (request.method === "tools/list") {
    respond(request.id, {
      tools: [
        {
          name: "echo",
          description: "Echo tool",
          inputSchema: {
            type: "object",
            properties: {
              value: {
                type: "string",
              },
            },
          },
        },
      ],
    });
    return;
  }

  if (request.method === "tools/call") {
    const toolName =
      typeof request.params?.name === "string" ? request.params.name : "";
    const args =
      request.params && typeof request.params.arguments === "object"
        ? request.params.arguments
        : {};
    respond(request.id, {
      tool: toolName,
      args,
      content: [
        {
          type: "text",
          text: `echo:${toolName}`,
        },
      ],
    });
    return;
  }

  if (request.method === "shutdown") {
    respond(request.id, {});
    return;
  }

  process.stdout.write(
    `${JSON.stringify({
      jsonrpc: "2.0",
      id: request.id,
      error: {
        code: -32601,
        message: `Unknown method: ${request.method ?? ""}`,
      },
    })}\n`,
  );
}

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk: string) => {
  buffer += chunk;

  while (true) {
    const newline = buffer.indexOf("\n");
    if (newline < 0) {
      break;
    }

    const line = buffer.slice(0, newline).trim();
    buffer = buffer.slice(newline + 1);

    if (!line) {
      continue;
    }

    try {
      handleRequest(JSON.parse(line) as JsonRpcRequest);
    } catch {
      // ignore malformed input in test fixture
    }
  }
});
