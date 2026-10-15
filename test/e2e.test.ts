// Builds the examples with the CLI and runs them on the shipped runtime as
// the worker does: one request at a time, stdin closed after the last answer.
import { type ChildProcessWithoutNullStreams, execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";

import { beforeAll, describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..");
const META = {
	"io.modelcontextprotocol/protocolVersion": "2026-07-28",
	"io.modelcontextprotocol/clientInfo": { name: "subako", version: "0" },
	"io.modelcontextprotocol/clientCapabilities": {},
};

const FIXTURES = {
	"/repos/microsoft/typescript": JSON.stringify({
		full_name: "microsoft/TypeScript",
		description: "TypeScript is a superset of JavaScript.",
		stargazers_count: 100000,
		forks_count: 12000,
		open_issues_count: 5000,
		html_url: "https://github.com/microsoft/TypeScript",
	}),
	"/repos/microsoft/typescript/issues": JSON.stringify([
		{ number: 2, title: "a bug", user: { login: "dev" }, comments: 3, html_url: "https://github.com/microsoft/TypeScript/issues/2" },
		{ number: 1, title: "a fix", user: { login: "dev" }, comments: 0, html_url: "https://github.com/microsoft/TypeScript/pull/1", pull_request: {} },
	]),
};

interface Session {
	answers: Record<string, any>[];
	volume: string;
	http: Record<string, any>[];
}

async function session(example: string, requests: { method: string; params?: Record<string, unknown> }[]): Promise<Session> {
	const volume = mkdtempSync(join(tmpdir(), "subako-volume-"));
	const fixtures = join(volume, "..", `${volume.split("/").pop()}.json`);
	writeFileSync(fixtures, JSON.stringify(FIXTURES));
	const child: ChildProcessWithoutNullStreams = spawn(process.execPath, [join(ROOT, "test", "worker.mjs"), join(ROOT, "examples", example, "dist"), volume, fixtures]);
	let stderr = "";
	child.stderr.on("data", (chunk) => (stderr += chunk));
	const lines = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
	const answers = [];
	for (const [i, request] of requests.entries()) {
		child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: i + 1, method: request.method, params: { ...request.params, _meta: META } })}\n`);
		const line = await Promise.race([lines.next(), new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`no answer to ${request.method}: ${stderr}`)), 10_000))]);
		if (line.done) throw new Error(`stdout ended before an answer to ${request.method}: ${stderr}`);
		answers.push(JSON.parse(line.value));
	}
	child.stdin.end();
	const code = await new Promise((resolve) => child.on("exit", resolve));
	expect(code, stderr).toBe(0);
	const log = join(volume, ".http.log");
	const http = existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").map((line) => JSON.parse(line)) : [];
	return { answers, volume, http };
}

const call = (name: string, args: Record<string, unknown>) => ({ method: "tools/call", params: { name, arguments: args } });

beforeAll(() => {
	if (!existsSync(join(ROOT, "dist", "cli.js"))) throw new Error("build the SDK first: pnpm build");
	for (const example of ["github", "github-mcp"]) {
		execFileSync(process.execPath, [join(ROOT, "bin", "subako-function.js"), "build"], { cwd: join(ROOT, "examples", example), stdio: "pipe" });
	}
}, 60_000);

describe.each(["github", "github-mcp"])("%s on the runtime", (example) => {
	it("is surveyed", async () => {
		const { answers } = await session(example, [{ method: "server/discover" }, { method: "tools/list" }]);
		expect(answers[0]!.result.supportedVersions).toContain("2026-07-28");
		expect(answers[1]!.result.tools.map((t: { name: string }) => t.name).sort()).toEqual(["avatar", "issues", "repo"]);
	});

	it("reads a repository through fetch", async () => {
		const { answers, http } = await session(example, [call("repo", { owner: "microsoft", repo: "typescript" })]);
		expect(answers[0]!.result.structuredContent).toMatchObject({ full_name: "microsoft/TypeScript", stars: 100000 });
		expect(http[0]).toMatchObject({ method: "GET", url: "https://api.github.com/repos/microsoft/typescript", headers: { accept: "application/vnd.github+json" } });
	});

	it("leaves pull requests out of the issues", async () => {
		const { answers, http } = await session(example, [call("issues", { owner: "microsoft", repo: "typescript", label: "Bug" })]);
		expect(answers[0]!.result.structuredContent.issues.map((i: { number: number }) => i.number)).toEqual([2]);
		expect(http[0]!.url).toBe("https://api.github.com/repos/microsoft/typescript/issues?state=open&per_page=10&labels=Bug");
	});

	it("turns a missing repository and bad input into tool errors", async () => {
		const { answers, http } = await session(example, [call("repo", { owner: "nobody", repo: "nothing" }), call("repo", { owner: "x" })]);
		expect(answers[0]!.result).toMatchObject({ isError: true, content: [{ text: "GitHub has nothing at /repos/nobody/nothing" }] });
		expect(answers[1]!.result.isError).toBe(true);
		expect(http).toHaveLength(1);
	});

	it("saves an avatar to the volume and shows it", async () => {
		const { answers, volume } = await session(example, [call("avatar", { owner: "microsoft" })]);
		expect(answers[0]!.result.content.at(-1)).toEqual({ type: "resource_link", uri: "volume:///tmp/avatar-microsoft.png", name: "avatar-microsoft.png" });
		expect(existsSync(join(volume, "tmp", "avatar-microsoft.png"))).toBe(true);
	});
});
