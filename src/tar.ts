// A gzipped tar of regular files, in the subako CLI's own conventions: GNU
// headers, entries sorted by path, mode 0644, mtime zero, so the same files
// always pack to the same bytes. A path past the 100 bytes a header holds
// travels in a GNU long-name entry before it.

import { gzipSync } from "node:zlib";

export interface TarEntry {
	/** "/"-joined, relative to the archive's root. */
	path: string;
	bytes: Uint8Array;
}

const BLOCK = 512;
const NAME_BYTES = 100;
const encoder = new TextEncoder();

export function gzippedTar(entries: readonly TarEntry[]): Uint8Array {
	const sorted = [...entries].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
	const blocks: Uint8Array[] = [];
	for (const { path, bytes } of sorted) {
		const name = encoder.encode(path);
		if (name.length > NAME_BYTES) {
			const long = new Uint8Array(name.length + 1);
			long.set(name);
			blocks.push(header(encoder.encode("././@LongLink"), long.length, "L"), ...padded(long));
		}
		blocks.push(header(name.subarray(0, NAME_BYTES), bytes.length, "0"), ...padded(bytes));
	}
	blocks.push(new Uint8Array(2 * BLOCK));
	return gzipSync(concat(blocks));
}

function header(name: Uint8Array, size: number, type: "0" | "L"): Uint8Array {
	const block = new Uint8Array(BLOCK);
	const put = (offset: number, value: string) => block.set(encoder.encode(value), offset);
	block.set(name, 0);
	put(100, "0000644\0");
	put(108, "0000000\0");
	put(116, "0000000\0");
	put(124, `${size.toString(8).padStart(11, "0")}\0`);
	put(136, "00000000000\0");
	put(148, "        ");
	put(156, type);
	put(257, "ustar  \0");
	let sum = 0;
	for (const byte of block) sum += byte;
	put(148, `${sum.toString(8).padStart(6, "0")}\0 `);
	return block;
}

/** `bytes`, then zeros to the next block boundary. */
function padded(bytes: Uint8Array): Uint8Array[] {
	const rest = bytes.length % BLOCK;
	return rest === 0 ? [bytes] : [bytes, new Uint8Array(BLOCK - rest)];
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
	const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
	let at = 0;
	for (const part of parts) {
		out.set(part, at);
		at += part.length;
	}
	return out;
}
