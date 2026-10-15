/** The primitives the shared runtime module gives the bundle as `__subako`. */
export interface Host {
	/** Writes one stdout line, flushed. */
	write(line: string): void;
	/** Writes one stderr line. */
	log(line: string): void;
	/** The worker's `subako_http` import: a JSON request in, a JSON answer out. */
	http(request: string): string;
	readFile(path: string): ArrayBuffer;
	writeFile(path: string, bytes: Uint8Array, append?: boolean): void;
	mkdir(path: string): void;
	remove(path: string): void;
	stat(path: string): { size: number; isDirectory: boolean } | null;
	readDir(path: string): { name: string; isDirectory: boolean }[];
	encodeUtf8(text: string): ArrayBuffer;
	decodeUtf8(bytes: Uint8Array, fatal?: boolean): string;
	/** Cryptographically random bytes. */
	randomBytes(length: number): ArrayBuffer;
}

declare global {
	var __subako: Host | undefined;
	var __subako_deliver: ((line: string) => void) | undefined;
	var __subako_tick: (() => number) | undefined;
}

export function host(): Host {
	const found = globalThis.__subako;
	if (found === undefined) {
		throw new Error("this runs only inside Subako's function runtime; build the package with `subako-function build`");
	}
	return found;
}
