import "./host.js";

import { beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

import { answer, serve, tool } from "../src/index.js";
import { clearTimer, setTimer, tick } from "../src/loop.js";
import { written } from "./host.js";

const META = {
	"io.modelcontextprotocol/protocolVersion": "2026-07-28",
	"io.modelcontextprotocol/clientInfo": { name: "subako", version: "0" },
	"io.modelcontextprotocol/clientCapabilities": {},
};

let nextId = 1;

/** Delivers a request and waits for the line it writes. */
async function ask(
	method: string,
	params: Record<string, unknown> = {},
	meta: Record<string, unknown> = META,
): Promise<Record<string, any>> {
	const before = written.length;
	globalThis.__subako_deliver?.(
		JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, params: { ...params, _meta: meta } }),
	);
	for (let i = 0; i < 50 && written.length === before; i++) await new Promise((resolve) => setTimeout(resolve, 0));
	expect(written.length).toBe(before + 1);
	return JSON.parse(written.at(-1)!);
}

const call = async (name: string, args: unknown) => (await ask("tools/call", { name, arguments: args })).result;

beforeAll(() => {
	serve([
		tool({
			name: "repo",
			description: "A repository.",
			input: z.object({ owner: z.string(), limit: z.number().int().max(50).default(10) }),
			output: z.object({ owner: z.string(), limit: z.number() }),
			run: ({ owner, limit }) => ({ owner, limit }),
		}),
		tool({
			name: "plain",
			description: "Takes a JSON Schema.",
			input: { type: "object", properties: { q: { type: "string" } } },
			run: (input) => `got ${String(input.q)}`,
		}),
		tool({ name: "boom", description: "Throws.", run: () => Promise.reject(new Error("GitHub is down")) }),
		tool({
			name: "wrong",
			description: "Breaks its own output schema.",
			output: z.object({ n: z.number() }),
			run: () => ({ n: "one" }) as never,
		}),
		tool({
			name: "chart",
			description: "Shows an image.",
			run: () => answer({ path: "/volume/tmp/chart.png" }).withImageFile("/volume/tmp/chart.png"),
		}),
		tool({
			name: "slow",
			description: "Waits on a timer.",
			run: () => new Promise<{ waited: boolean }>((resolve) => setTimer(() => resolve({ waited: true }), 30, false)),
		}),
		tool({ name: "stuck", description: "Never settles.", run: () => new Promise<undefined>(() => {}) }),
	]);
});

describe("the protocol", () => {
	it("discovers the revision and tools", async () => {
		const { result } = await ask("server/discover");
		expect(result).toEqual({
			supportedVersions: ["2026-07-28"],
			capabilities: { tools: {} },
			resultType: "complete",
			_meta: { "io.modelcontextprotocol/serverInfo": { name: "package", version: "0.0.0" } },
		});
	});

	it("lists every tool with JSON Schemas from zod or as written", async () => {
		const { result } = await ask("tools/list");
		expect(result.tools.map((t: { name: string }) => t.name)).toEqual([
			"repo",
			"plain",
			"boom",
			"wrong",
			"chart",
			"slow",
			"stuck",
		]);
		expect(result.tools[0].inputSchema).toMatchObject({ type: "object", required: ["owner"] });
		expect(result.tools[0].inputSchema.$schema).toBeUndefined();
		expect(result.tools[0].outputSchema).toMatchObject({ type: "object", required: ["owner", "limit"] });
		expect(result.tools[1].inputSchema).toEqual({ type: "object", properties: { q: { type: "string" } } });
		expect(result.tools[1].outputSchema).toBeUndefined();
		expect(result.tools[2].inputSchema).toEqual({ type: "object", properties: {} });
		expect(result).toMatchObject({ ttlMs: 86_400_000, cacheScope: "public" });
	});

	it("refuses a cursor, since every tool is on the first page", async () => {
		expect((await ask("tools/list", { cursor: "2" })).error.code).toBe(-32602);
	});

	it("refuses another revision, naming the one it speaks", async () => {
		const { error } = await ask(
			"server/discover",
			{},
			{ ...META, "io.modelcontextprotocol/protocolVersion": "2025-11-25" },
		);
		expect(error).toEqual({
			code: -32022,
			message: "Unsupported protocol version",
			data: { supported: ["2026-07-28"], requested: "2025-11-25" },
		});
	});

	it("refuses a request without client capabilities", async () => {
		const { "io.modelcontextprotocol/clientCapabilities": _, ...meta } = META;
		expect((await ask("server/discover", {}, meta)).error.code).toBe(-32602);
	});

	it("refuses an unknown method and a line that is not JSON", async () => {
		expect((await ask("resources/list")).error.code).toBe(-32601);
		globalThis.__subako_deliver?.("{nope");
		expect(JSON.parse(written.at(-1)!)).toMatchObject({ id: null, error: { code: -32700 } });
	});

	it("ignores notifications and responses", () => {
		const before = written.length;
		globalThis.__subako_deliver?.(JSON.stringify({ jsonrpc: "2.0", method: "notifications/cancelled", params: {} }));
		globalThis.__subako_deliver?.(JSON.stringify({ jsonrpc: "2.0", id: 9, result: {} }));
		expect(written.length).toBe(before);
	});
});

describe("a call", () => {
	it("hands run the schema's parsed input and sends its value as JSON and structured content", async () => {
		expect(await call("repo", { owner: "microsoft" })).toEqual({
			content: [{ type: "text", text: '{"owner":"microsoft","limit":10}' }],
			structuredContent: { owner: "microsoft", limit: 10 },
			resultType: "complete",
			_meta: { "io.modelcontextprotocol/serverInfo": { name: "package", version: "0.0.0" } },
		});
	});

	it("turns input the schema refuses into a tool error naming each problem", async () => {
		const result = await call("repo", { limit: 99 });
		expect(result.isError).toBe(true);
		expect(result.content[0].text).toMatch(/^Invalid arguments: owner: .+; limit: .+/);
	});

	it("passes input as it is when the schema is plain JSON Schema", async () => {
		expect((await call("plain", { q: "x" })).content).toEqual([{ type: "text", text: "got x" }]);
	});

	it("turns a thrown error into a tool error", async () => {
		expect(await call("boom", {})).toMatchObject({
			content: [{ type: "text", text: "GitHub is down" }],
			isError: true,
		});
	});

	it("refuses output its schema refuses", async () => {
		const result = await call("wrong", {});
		expect(result.isError).toBe(true);
		expect(result.content[0].text).toMatch(/^The tool's output does not match its schema: n: /);
	});

	it("shows an Answer's image after its value", async () => {
		expect((await call("chart", {})).content).toEqual([
			{ type: "text", text: '{"path":"/volume/tmp/chart.png"}' },
			{ type: "resource_link", uri: "volume:///tmp/chart.png", name: "chart.png" },
		]);
	});

	it("answers an unknown tool with a tool error", async () => {
		expect(await call("nope", {})).toMatchObject({
			content: [{ type: "text", text: "unknown tool: nope" }],
			isError: true,
		});
	});
});

describe("the loop the runtime drives", () => {
	it("sleeps until a timer a call waits on, then runs it", async () => {
		const before = written.length;
		globalThis.__subako_deliver?.(
			JSON.stringify({ jsonrpc: "2.0", id: "slow", method: "tools/call", params: { name: "slow", _meta: META } }),
		);
		await new Promise((resolve) => setTimeout(resolve, 0));
		const wait = tick();
		expect(wait).toBeGreaterThan(0);
		expect(wait).toBeLessThanOrEqual(30);
		await new Promise((resolve) => setTimeout(resolve, wait + 5));
		expect(tick()).toBe(0);
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(JSON.parse(written[before]!).result.structuredContent).toEqual({ waited: true });
		expect(tick()).toBe(-1);
	});

	it("runs a timer set by a timer on the next tick", () => {
		const runs: string[] = [];
		setTimer(
			() => {
				runs.push("first");
				setTimer(() => runs.push("second"), 0, false);
			},
			0,
			false,
		);
		expect(tick()).toBe(0);
		expect(runs).toEqual(["first"]);
		expect(tick()).toBe(0);
		expect(runs).toEqual(["first", "second"]);
	});

	it("reads on when no call waits, whatever timers are left", () => {
		const interval = setTimer(() => {}, 60_000, true);
		expect(tick()).toBe(-1);
		setTimer(() => {}, 0, false);
		expect(tick()).toBe(0);
		clearTimer(interval);
	});

	it("answers a call nothing can settle once no timer is left to settle it", async () => {
		const before = written.length;
		globalThis.__subako_deliver?.(
			JSON.stringify({ jsonrpc: "2.0", id: "stuck", method: "tools/call", params: { name: "stuck", _meta: META } }),
		);
		await new Promise((resolve) => setTimeout(resolve, 0));
		const timer = setTimer(() => {}, 60_000, false);
		expect(tick()).toBeGreaterThan(0);
		expect(written.length).toBe(before);
		clearTimer(timer);
		expect(tick()).toBe(0);
		expect(JSON.parse(written[before]!)).toMatchObject({
			id: "stuck",
			result: { content: [{ type: "text", text: "stuck returned a promise that nothing can settle" }], isError: true },
		});
		expect(tick()).toBe(-1);
	});
});

describe("defining tools", () => {
	it("refuses an input schema that is not an object", () => {
		expect(() => tool({ name: "x", description: "", input: z.string() as never, run: () => ({}) })).toThrow(
			/object schema/,
		);
	});

	it("refuses two tools with one name", () => {
		const t = tool({ name: "same", description: "", run: () => ({}) });
		expect(() => serve([t, t])).toThrow(/two tools are named same/);
	});
});
