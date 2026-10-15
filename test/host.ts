// A host for tests under Node: what the runtime gives the bundle as __subako,
// with stdout lines and subako_http requests kept for the test to read.
import * as nodeFs from "node:fs";

import type { Host } from "../src/host.js";

export const written: string[] = [];
export const httpSent: Record<string, unknown>[] = [];
export let httpAnswer: (request: Record<string, unknown>) => unknown = () => ({
	error: { kind: "host_not_allowed", message: "this function has no network access" },
});

export function answerHttp(answer: typeof httpAnswer): void {
	httpAnswer = answer;
}

const host: Host = {
	write: (line) => void written.push(line),
	log: () => {},
	http: (request) => {
		const parsed = JSON.parse(request);
		httpSent.push(parsed);
		return JSON.stringify(httpAnswer(parsed));
	},
	readFile: (path) => new Uint8Array(nodeFs.readFileSync(path)).buffer,
	writeFile: (path, bytes, append) => (append ? nodeFs.appendFileSync(path, bytes) : nodeFs.writeFileSync(path, bytes)),
	mkdir: (path) => void nodeFs.mkdirSync(path, { recursive: true }),
	remove: (path) => nodeFs.rmSync(path, { recursive: true, force: true }),
	stat: (path) => {
		const stat = nodeFs.statSync(path, { throwIfNoEntry: false });
		return stat === undefined ? null : { size: stat.size, isDirectory: stat.isDirectory() };
	},
	readDir: (path) => nodeFs.readdirSync(path, { withFileTypes: true }).map((e) => ({ name: e.name, isDirectory: e.isDirectory() })),
	encodeUtf8: (text) => new Uint8Array(Buffer.from(text, "utf8")).buffer,
	decodeUtf8: (bytes, fatal) => new TextDecoder("utf-8", { fatal: fatal ?? false }).decode(bytes),
	randomBytes: (length) => new Uint8Array(length).map(() => Math.floor(Math.random() * 256)).buffer,
};

globalThis.__subako = host;
