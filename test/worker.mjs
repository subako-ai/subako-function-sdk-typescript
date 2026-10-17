// Runs a built package as a child process, the way the function worker runs
// it: /package is its assets, /volume a scratch directory, stdin and stdout
// the process's own. subako_http answers from the fixtures file: an inline
// body by URL path, or a file written into the volume when one is asked for.
//
// node worker.mjs <dist> <volume> <fixtures.json>
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { WASI } from "node:wasi";

process.removeAllListeners("warning");
const [dist, volume, fixturesPath] = process.argv.slice(2);
const fixtures = JSON.parse(readFileSync(fixturesPath, "utf8"));
const wasi = new WASI({
	version: "preview1",
	args: ["module"],
	env: {},
	preopens: { "/package": join(dist, "assets"), "/volume": volume },
	returnOnExit: true,
});

let memory;
let pending = new Uint8Array();
function answer(request) {
	const url = new URL(request.url);
	if (request.output?.type === "file") {
		const file = join(volume, request.output.path.replace(/^\/volume\//, ""));
		mkdirSync(dirname(file), { recursive: true });
		writeFileSync(file, "\x89PNG");
		return { ok: { status: 200, headers: {}, body: { type: "file", path: request.output.path, bytes: 4 } } };
	}
	const body = fixtures[url.pathname];
	if (body === undefined)
		return { ok: { status: 404, headers: {}, body: { type: "inline", text: '{"message":"Not Found"}' } } };
	return { ok: { status: 200, headers: { "content-type": "application/json" }, body: { type: "inline", text: body } } };
}
const subako_http = {
	request(ptr, len) {
		const request = JSON.parse(new TextDecoder().decode(new Uint8Array(memory.buffer, ptr, len)));
		writeFileSync(join(volume, ".http.log"), `${JSON.stringify(request)}\n`, { flag: "a" });
		pending = new TextEncoder().encode(JSON.stringify(answer(request)));
		return pending.length;
	},
	read_response(ptr, len) {
		new Uint8Array(memory.buffer, ptr, len).set(pending.subarray(0, len));
		return 0;
	},
};
const module = await WebAssembly.compile(readFileSync(join(dist, "module.wasm")));
const instance = await WebAssembly.instantiate(module, { ...wasi.getImportObject(), subako_http });
memory = instance.exports.memory;
process.exitCode = wasi.start(instance);
