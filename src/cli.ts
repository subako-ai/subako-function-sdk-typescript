// subako-function build [entry] [--out dir] [--no-minify] [--source]
//
// Bundles the package's entry for the shared runtime and lays out the
// directory `subako function create` and `push` take: the runtime as
// module.wasm, the bundle as assets/main.qjsbc, the package's own assets/
// beside it, and its subako-package.json.
//
// The bundle ships as QuickJS bytecode, which the runtime itself compiles
// here, so a call skips parsing it. --source ships assets/main.js instead.

import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import { parseArgs } from "node:util";
import { WASI } from "node:wasi";
import { build } from "esbuild";

// The runtime compiles the bundle under node:wasi, whose experimental notice
// says nothing to someone building a package.
process.removeAllListeners("warning");
process.on("warning", (warning) => {
	if (!/WASI/.test(warning.message)) console.warn(warning);
});

const MANIFEST = "subako-package.json";
const SOURCE = "main.js";
const BYTECODE = "main.qjsbc";
const ENTRIES = ["src/index.ts", "src/index.js", "index.ts", "index.js"];

function fail(message: string): never {
	console.error(`subako-function: ${message}`);
	process.exit(1);
}

function readManifest(root: string): { abi: 1; name: string; description: string } {
	const path = join(root, MANIFEST);
	if (!existsSync(path)) fail(`no ${MANIFEST} in ${root}; write {"abi": 1, "name": ..., "description": ...}`);
	let manifest: unknown;
	try {
		manifest = JSON.parse(readFileSync(path, "utf8"));
	} catch (error) {
		fail(`${MANIFEST} is not JSON: ${(error as Error).message}`);
	}
	const { abi, name, description } = manifest as Record<string, unknown>;
	if (abi !== 1) fail(`${MANIFEST}: abi must be 1`);
	if (typeof name !== "string" || typeof description !== "string") fail(`${MANIFEST}: name and description must be strings`);
	return { abi, name, description };
}

async function buildPackage(args: string[]): Promise<void> {
	const { values, positionals } = parseArgs({
		args,
		allowPositionals: true,
		options: {
			out: { type: "string", default: "dist" },
			"no-minify": { type: "boolean", default: false },
			source: { type: "boolean", default: false },
		},
	});
	const root = process.cwd();
	const manifest = readManifest(root);
	const entry = positionals[0] ?? ENTRIES.find((candidate) => existsSync(join(root, candidate)));
	if (entry === undefined) fail(`no entry given, and none of ${ENTRIES.join(", ")} exists`);
	const out = resolve(root, values.out);
	const assets = join(root, "assets");
	for (const reserved of [SOURCE, BYTECODE]) {
		if (existsSync(join(assets, reserved))) fail(`assets/${reserved} is where the bundle goes; rename that asset`);
	}

	rmSync(out, { recursive: true, force: true });
	mkdirSync(join(out, "assets"), { recursive: true });
	if (existsSync(assets)) cpSync(assets, join(out, "assets"), { recursive: true });

	const result = await build({
		stdin: {
			// The globals go first, so a library that reads fetch or URL as it loads finds them.
			contents: `import "@subako-ai/function-sdk/globals";\nimport ${JSON.stringify(`./${relative(root, resolve(root, entry))}`)};\n`,
			resolveDir: root,
			sourcefile: "subako-entry.js",
		},
		bundle: true,
		format: "esm",
		platform: "neutral",
		target: "es2023",
		mainFields: ["module", "main"],
		conditions: ["browser"],
		minify: !values["no-minify"],
		define: { __SUBAKO_PACKAGE_NAME__: JSON.stringify(manifest.name) },
		outfile: join(out, "assets", SOURCE),
		logLevel: "warning",
	}).catch(() => fail("the bundle did not build"));
	if (result.errors.length > 0) fail("the bundle did not build");

	const runtime = join(dirname(createRequire(import.meta.url).resolve("@subako-ai/function-sdk/package.json")), "runtime", "module.wasm");
	if (!existsSync(runtime)) fail(`the runtime is missing from ${runtime}`);
	cpSync(runtime, join(out, "module.wasm"));
	if (!values.source) {
		await compile(runtime, join(out, "assets"));
		rmSync(join(out, "assets", SOURCE));
	}
	writeFileSync(join(out, MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`);
	console.log(`built ${manifest.name} into ${relative(root, out) || "."}; upload it with: subako function create ${relative(root, out)}`);
}

/** Has the runtime write `main.js` in `assets` as bytecode beside it. */
async function compile(runtime: string, assets: string): Promise<void> {
	const wasi = new WASI({ version: "preview1", args: ["module", "--compile"], env: {}, preopens: { "/package": assets }, returnOnExit: true });
	const unavailable = () => -1;
	const instance = await WebAssembly.instantiate(await WebAssembly.compile(readFileSync(runtime)), {
		...wasi.getImportObject(),
		subako_http: { request: unavailable, read_response: unavailable },
	});
	if (wasi.start(instance) !== 0) fail("the bundle did not compile");
}

const [command, ...rest] = process.argv.slice(2);
switch (command) {
	case "build":
		await buildPackage(rest);
		break;
	default:
		fail("usage: subako-function build [entry] [--out dir] [--no-minify] [--source]");
}
