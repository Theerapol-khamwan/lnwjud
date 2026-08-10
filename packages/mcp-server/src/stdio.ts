import { serveStdio, type StdioServerHandle } from '@modelcontextprotocol/server/stdio';
import { createMcpServer, type McpServerOptions } from './server.js';

export interface McpStdioOptions extends McpServerOptions {
  readonly onError?: (error: Error) => void;
}

function writeStdioDiagnostic(error: Error): void {
  process.stderr.write(`lnwjud MCP stdio error: ${error.message}\n`);
}

export function startMcpStdio(options: McpStdioOptions): StdioServerHandle {
  return serveStdio(
    () => createMcpServer(options),
    { legacy: 'reject', onerror: options.onError ?? writeStdioDiagnostic },
  );
}
