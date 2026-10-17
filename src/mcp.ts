// Serves a server built with the official MCP TypeScript SDK
// (`@modelcontextprotocol/server`) over the runtime's stdio.

import "./globals.js";

import { serveStdio } from "@modelcontextprotocol/server/stdio";

import { host } from "./host.js";
import { answered, awaitAnswer } from "./loop.js";

type JsonRpc = { id?: string | number; method?: string; result?: unknown; error?: unknown };

/** An MCP transport over the runtime: each stdin line in, one stdout line out. */
export class SubakoTransport {
	onmessage?: (message: JsonRpc) => void;
	onerror?: (error: Error) => void;
	onclose?: () => void;

	async start(): Promise<void> {
		globalThis.__subako_deliver = (line) => {
			let message: JsonRpc;
			try {
				message = JSON.parse(line);
			} catch (error) {
				this.onerror?.(error as Error);
				return;
			}
			const { id } = message;
			if (id !== undefined && typeof message.method === "string") {
				awaitAnswer(
					id,
					() =>
						void this.send({
							jsonrpc: "2.0",
							id,
							error: { code: -32603, message: `${message.method} returned a promise that nothing can settle` },
						} as JsonRpc),
				);
			}
			this.onmessage?.(message);
		};
	}

	async send(message: JsonRpc): Promise<void> {
		if (message.id !== undefined && ("result" in message || "error" in message)) answered(message.id);
		host().write(JSON.stringify(message));
	}

	async close(): Promise<void> {
		this.onclose?.();
	}
}

/**
 * Answers the worker's requests with the server `create` makes, as
 * `serveStdio` from the official SDK does on a process's stdio.
 *
 * ```ts
 * serveMcp(() => {
 *   const server = new McpServer({ name: "github", version: "0.1.0" });
 *   server.registerTool("repo", { ... }, async (input) => { ... });
 *   return server;
 * });
 * ```
 */
export function serveMcp(create: Parameters<typeof serveStdio>[0]): void {
	serveStdio(create, {
		transport: new SubakoTransport() as never,
		onerror: (error: unknown) => console.error(error),
	} as never);
}
