import { expect, test } from "bun:test";
import path from "node:path";

import {
  callMcpTool,
  createMcpSession,
  listMcpTools,
} from "$/integrations/mcp/client";

const mockServerCommand = [
  "bun",
  path.resolve(import.meta.dir, "fixtures/mock-mcp-server.ts"),
];

test("listMcpTools reads tools from MCP server", async () => {
  const tools = await listMcpTools({
    server: {
      command: mockServerCommand,
    },
  });

  expect(tools).toHaveLength(1);
  expect(tools[0]?.name).toBe("echo");
  expect(tools[0]?.description).toBe("Echo tool");
});

test("callMcpTool executes tool call via MCP server", async () => {
  const result = (await callMcpTool({
    server: {
      command: mockServerCommand,
    },
    tool: "echo",
    args: {
      value: "hello",
    },
  })) as { content?: Array<{ type?: string; text?: string }> };

  expect(Array.isArray(result.content)).toBe(true);
  expect(result.content?.[0]?.type).toBe("text");
  expect(result.content?.[0]?.text).toBe("echo:echo");
});

test("createMcpSession reuses initialized session across calls", async () => {
  const session = await createMcpSession({
    server: {
      command: mockServerCommand,
    },
  });

  const tools = await session.listTools();
  expect(tools.map((tool) => tool.name)).toEqual(["echo"]);

  const result = (await session.callTool({
    tool: "echo",
    args: {
      value: "world",
    },
  })) as { tool?: string; args?: { value?: string } };
  expect(result.tool).toBe("echo");
  expect(result.args?.value).toBe("world");

  await session.close();
  await session.close();
});
