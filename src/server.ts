import { host } from "./host.js";
import { answered, awaitAnswer } from "./loop.js";
import type { Tool } from "./tool.js";

// The same revision, keys and codes the Rust function SDK answers with.
const REVISION = "2026-07-28";
const PROTOCOL_VERSION_KEY = "io.modelcontextprotocol/protocolVersion";
const CLIENT_CAPABILITIES_KEY = "io.modelcontextprotocol/clientCapabilities";
const SERVER_INFO_KEY = "io.modelcontextprotocol/serverInfo";
const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;
const UNSUPPORTED_PROTOCOL_VERSION = -32022;
const TOOLS_TTL_MS = 24 * 60 * 60 * 1000;

export interface ServerInfo {
	name: string;
	version: string;
}

declare const __SUBAKO_PACKAGE_NAME__: string | undefined;

type Id = string | number;
type Message = { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: unknown; result?: unknown; error?: unknown };

/**
 * Answers the worker's MCP requests with `tools`. Call it once, from the
 * bundle's entry; `info` defaults to the package's name from
 * `subako-package.json`.
 */
export function serve(tools: readonly Tool[], info?: Partial<ServerInfo>): void {
	const byName = new Map<string, Tool>();
	for (const tool of tools) {
		if (byName.has(tool.name)) throw new Error(`two tools are named ${tool.name}`);
		byName.set(tool.name, tool);
	}
	const server: ServerInfo = {
		name: info?.name ?? (typeof __SUBAKO_PACKAGE_NAME__ === "string" ? __SUBAKO_PACKAGE_NAME__ : "package"),
		version: info?.version ?? "0.0.0",
	};
	const out = host();
	const send = (message: Record<string, unknown>) => out.write(JSON.stringify({ jsonrpc: "2.0", ...message }));
	const respond = (id: Id, fields: Record<string, unknown>) =>
		send({ id, result: { ...fields, resultType: "complete", _meta: { [SERVER_INFO_KEY]: server } } });
	const refuse = (id: Id | null, code: number, message: string, data?: unknown) =>
		send({ id, error: data === undefined ? { code, message } : { code, message, data } });

	globalThis.__subako_deliver = (line) => {
		let message: Message;
		try {
			message = JSON.parse(line);
		} catch (error) {
			return refuse(null, PARSE_ERROR, `not JSON: ${(error as Error).message}`);
		}
		if (message === null || typeof message !== "object" || Array.isArray(message)) {
			return refuse(null, INVALID_REQUEST, "not a message");
		}
		const id = typeof message.id === "string" || typeof message.id === "number" ? message.id : undefined;
		if (message.jsonrpc !== "2.0") return refuse(id ?? null, INVALID_REQUEST, `unknown JSON-RPC version: ${String(message.jsonrpc)}`);
		if (typeof message.method !== "string") {
			if (id !== undefined && ("result" in message || "error" in message)) return;
			return refuse(id ?? null, INVALID_REQUEST, "neither a request, a notification, nor a response");
		}
		if (id === undefined) return;
		const params = (message.params ?? {}) as Record<string, unknown>;
		const meta = (params._meta ?? {}) as Record<string, unknown>;
		const version = meta[PROTOCOL_VERSION_KEY];
		if (typeof version !== "string") {
			return refuse(id, INVALID_PARAMS, `missing _meta ${PROTOCOL_VERSION_KEY}; this server speaks MCP ${REVISION}`);
		}
		if (version !== REVISION) {
			return refuse(id, UNSUPPORTED_PROTOCOL_VERSION, "Unsupported protocol version", {
				supported: [REVISION],
				requested: version,
			});
		}
		const capabilities = meta[CLIENT_CAPABILITIES_KEY];
		if (capabilities === null || typeof capabilities !== "object" || Array.isArray(capabilities)) {
			return refuse(id, INVALID_PARAMS, `missing _meta ${CLIENT_CAPABILITIES_KEY}; this server speaks MCP ${REVISION}`);
		}
		switch (message.method) {
			case "server/discover":
				return respond(id, { supportedVersions: [REVISION], capabilities: { tools: {} } });
			case "tools/list":
				// Every tool is on the first page, so no cursor names another.
				if ("cursor" in params) return refuse(id, INVALID_PARAMS, "no such cursor");
				return respond(id, {
					tools: tools.map((tool) => tool.listing()),
					ttlMs: TOOLS_TTL_MS,
					cacheScope: "public",
				});
			case "tools/call": {
				if (typeof params.name !== "string") return refuse(id, INVALID_PARAMS, "invalid tools/call params: name is not a string");
				const tool = byName.get(params.name);
				if (tool === undefined) return respond(id, { content: [{ type: "text", text: `unknown tool: ${params.name}` }], isError: true });
				awaitAnswer(id, () =>
					respond(id, {
						content: [{ type: "text", text: `${tool.name} returned a promise that nothing can settle` }],
						isError: true,
					}),
				);
				void tool.call(params.arguments).then((result) => {
					if (answered(id)) respond(id, { ...result });
				});
				return;
			}
			default:
				return refuse(id, METHOD_NOT_FOUND, `unknown method: ${message.method}`);
		}
	};

}
