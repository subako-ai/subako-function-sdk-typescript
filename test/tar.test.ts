import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { gzippedTar } from "../src/tar.js";

const LONG = `assets/${"deep-directory-name/".repeat(6)}notes.txt`;
const encode = (text: string) => new TextEncoder().encode(text);

/** Writes `archive` and has the system's tar read it back. */
function untar(archive: Uint8Array): { listing: string; dir: string } {
	const dir = mkdtempSync(join(tmpdir(), "subako-tar-"));
	writeFileSync(join(dir, "bundle.tar.gz"), archive);
	const listing = execFileSync("tar", ["-tzvf", "bundle.tar.gz"], { cwd: dir, encoding: "utf8" });
	execFileSync("tar", ["-xzf", "bundle.tar.gz"], { cwd: dir });
	return { listing, dir };
}

describe("gzippedTar", () => {
	it("packs files that tar reads back, sorted, a long path included", () => {
		const archive = gzippedTar([
			{ path: "subako-package.json", bytes: encode('{"abi":1}') },
			{ path: LONG, bytes: encode("hello") },
			{ path: "module.wasm", bytes: new Uint8Array(1000).fill(7) },
		]);
		const { listing, dir } = untar(archive);
		const lines = listing.trim().split("\n");
		expect(lines.map((line) => line.split(/\s+/).at(-1))).toEqual([LONG, "module.wasm", "subako-package.json"]);
		for (const line of lines) expect(line).toMatch(/^-rw-r--r-- 0\/0 .* 1970-01-01 00:00 /);
		expect(readFileSync(join(dir, LONG), "utf8")).toBe("hello");
		expect(readFileSync(join(dir, "module.wasm"))).toEqual(Buffer.alloc(1000, 7));
	});

	it("packs the same files to the same bytes, whatever their order", () => {
		const a = { path: "a.txt", bytes: encode("a") };
		const b = { path: "b.txt", bytes: encode("b") };
		expect(gzippedTar([a, b])).toEqual(gzippedTar([b, a]));
	});
});
