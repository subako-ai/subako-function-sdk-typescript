// The globals Subako's function runtime provides, and only those: use it in
// place of DOM and Node types, so a global the runtime lacks is a type error.
//
//   "lib": ["ES2023"],
//   "types": ["@subako-ai/function-sdk/env"]
//
// The SDK installs these in src/globals.ts; test/env checks the two agree.

interface Console {
	log(...data: unknown[]): void;
	info(...data: unknown[]): void;
	warn(...data: unknown[]): void;
	error(...data: unknown[]): void;
	debug(...data: unknown[]): void;
	trace(...data: unknown[]): void;
}
declare var console: Console;

/** Runs while a call is being answered; a timer left once it is answered never fires. */
declare function setTimeout<A extends unknown[]>(handler: (...args: A) => void, timeout?: number, ...args: A): number;
declare function setInterval<A extends unknown[]>(handler: (...args: A) => void, timeout?: number, ...args: A): number;
declare function clearTimeout(id: number | undefined): void;
declare function clearInterval(id: number | undefined): void;
declare function queueMicrotask(callback: () => void): void;

interface Performance {
	now(): number;
	readonly timeOrigin: number;
}
declare var performance: Performance;

declare class TextEncoder {
	readonly encoding: "utf-8";
	encode(input?: string): Uint8Array<ArrayBuffer>;
}

/** UTF-8 only. */
declare class TextDecoder {
	constructor(label?: string, options?: { fatal?: boolean });
	readonly encoding: "utf-8";
	readonly fatal: boolean;
	decode(input?: ArrayBuffer | ArrayBufferView): string;
}

interface Crypto {
	getRandomValues<T extends ArrayBufferView>(array: T): T;
	randomUUID(): string;
}
declare var crypto: Crypto;

declare function btoa(data: string): string;
declare function atob(data: string): string;

interface AbortEvent {
	readonly type: "abort";
}
interface AbortSignal {
	readonly aborted: boolean;
	readonly reason: unknown;
	onabort: ((event: AbortEvent) => void) | null;
	addEventListener(type: "abort", listener: (event: AbortEvent) => void): void;
	removeEventListener(type: "abort", listener: (event: AbortEvent) => void): void;
	throwIfAborted(): void;
}
declare var AbortSignal: {
	readonly prototype: AbortSignal;
	timeout(ms: number): AbortSignal;
};
declare class AbortController {
	readonly signal: AbortSignal;
	abort(reason?: unknown): void;
}

declare class URLSearchParams implements Iterable<[string, string]> {
	constructor(init?: string | Record<string, string> | [string, string][]);
	get(name: string): string | null;
	getAll(name: string): string[];
	has(name: string): boolean;
	set(name: string, value: string): void;
	append(name: string, value: string): void;
	delete(name: string): void;
	forEach(callback: (value: string, name: string) => void): void;
	entries(): IterableIterator<[string, string]>;
	[Symbol.iterator](): IterableIterator<[string, string]>;
	toString(): string;
}

/** Absolute URLs and the relative references APIs build. */
declare class URL {
	constructor(url: string | URL, base?: string | URL);
	protocol: string;
	host: string;
	pathname: string;
	search: string;
	hash: string;
	readonly hostname: string;
	readonly port: string;
	readonly origin: string;
	readonly href: string;
	readonly searchParams: URLSearchParams;
	toString(): string;
	toJSON(): string;
}

type HeadersInit = Record<string, string> | [string, string][] | Headers;

declare class Headers implements Iterable<[string, string]> {
	constructor(init?: HeadersInit);
	get(name: string): string | null;
	has(name: string): boolean;
	set(name: string, value: string): void;
	append(name: string, value: string): void;
	delete(name: string): void;
	forEach(callback: (value: string, name: string) => void): void;
	entries(): IterableIterator<[string, string]>;
	[Symbol.iterator](): IterableIterator<[string, string]>;
}

interface ResponseInit {
	status?: number;
	statusText?: string;
	headers?: Record<string, string>;
	url?: string;
}

/** A response with a text body, which is all the worker returns inline. */
declare class Response {
	constructor(body?: string | null, init?: ResponseInit);
	readonly headers: Headers;
	readonly status: number;
	readonly statusText: string;
	readonly url: string;
	readonly redirected: boolean;
	readonly type: "basic";
	readonly ok: boolean;
	readonly bodyUsed: boolean;
	text(): Promise<string>;
	json(): Promise<any>;
	arrayBuffer(): Promise<ArrayBuffer>;
	clone(): Response;
}

interface RequestInit {
	method?: string;
	headers?: HeadersInit;
	/** Text, or bytes that are valid UTF-8; send binary data as a volume file with `http.request`. */
	body?: string | Uint8Array | ArrayBuffer | URLSearchParams | null;
	signal?: AbortSignal;
	redirect?: "follow" | "manual";
}

/** Goes through the worker, which applies the function's network and credentials. */
declare function fetch(input: string | URL | { url: string }, init?: RequestInit): Promise<Response>;
