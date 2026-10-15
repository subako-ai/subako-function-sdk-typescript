// The web globals QuickJS lacks and scripts and libraries reach for. Each is
// installed only where the engine has none, so the SDK also runs under Node;
// the implementations are exported for tests there.

import { host } from "./host.js";
import { HttpError, request } from "./http.js";
import { clearTimer, setTimer, tick } from "./loop.js";

const g = globalThis as Record<string, unknown>;
const define = (name: string, value: unknown) => {
	if (g[name] === undefined) g[name] = value;
};

const show = (value: unknown): string => {
	if (typeof value === "string") return value;
	if (value instanceof Error) return value.stack ?? `${value.name}: ${value.message}`;
	try {
		return JSON.stringify(value) ?? String(value);
	} catch {
		return String(value);
	}
};
const log = (...values: unknown[]) => host().log(values.map(show).join(" "));
define("console", { log, info: log, warn: log, error: log, debug: log, trace: log });

define("setTimeout", (run: (...args: unknown[]) => void, ms?: number, ...args: unknown[]) => setTimer(() => run(...args), ms, false));
define("setInterval", (run: (...args: unknown[]) => void, ms?: number, ...args: unknown[]) => setTimer(() => run(...args), ms, true));
define("clearTimeout", clearTimer);
define("clearInterval", clearTimer);
define("queueMicrotask", (run: () => void) => void Promise.resolve().then(run));
if (g.__subako !== undefined) g.__subako_tick = tick;
define("performance", { now: () => Date.now(), timeOrigin: Date.now() });

export class TextEncoderShim {
	readonly encoding = "utf-8";
	encode(text = ""): Uint8Array {
		return new Uint8Array(host().encodeUtf8(String(text)));
	}
}
export class TextDecoderShim {
	readonly encoding = "utf-8";
	readonly fatal: boolean;
	constructor(label = "utf-8", options: { fatal?: boolean } = {}) {
		if (!/^utf-?8$/i.test(label)) throw new RangeError(`unsupported encoding: ${label}`);
		this.fatal = options.fatal ?? false;
	}
	decode(bytes?: ArrayBuffer | ArrayBufferView): string {
		if (bytes === undefined) return "";
		const view = ArrayBuffer.isView(bytes) ? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength) : new Uint8Array(bytes);
		return host().decodeUtf8(view, this.fatal);
	}
}
define("TextEncoder", TextEncoderShim);
define("TextDecoder", TextDecoderShim);

define("crypto", {
	getRandomValues<T extends ArrayBufferView>(array: T): T {
		const bytes = new Uint8Array(host().randomBytes(array.byteLength));
		new Uint8Array(array.buffer, array.byteOffset, array.byteLength).set(bytes);
		return array;
	},
	randomUUID(): string {
		const b = new Uint8Array(host().randomBytes(16));
		b[6] = ((b[6] ?? 0) & 0x0f) | 0x40;
		b[8] = ((b[8] ?? 0) & 0x3f) | 0x80;
		const hex = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
		return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
	},
});

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
define("btoa", (text: string) => {
	let out = "";
	for (let i = 0; i < text.length; i += 3) {
		const [a, b, c] = [text.charCodeAt(i), text.charCodeAt(i + 1), text.charCodeAt(i + 2)];
		if (a > 255 || b > 255 || c > 255) throw new Error("btoa: a character is outside Latin-1");
		const n = (a << 16) | ((b || 0) << 8) | (c || 0);
		out += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]! + (Number.isNaN(b) ? "=" : B64[(n >> 6) & 63]!) + (Number.isNaN(c) ? "=" : B64[n & 63]!);
	}
	return out;
});
define("atob", (encoded: string) => {
	const clean = encoded.replace(/[\s=]/g, "");
	let out = "";
	for (let i = 0; i < clean.length; i += 4) {
		let n = 0;
		for (let k = 0; k < 4; k++) n = (n << 6) | Math.max(B64.indexOf(clean[i + k] ?? "A"), 0);
		out += String.fromCharCode((n >> 16) & 255);
		if (clean[i + 2] !== undefined) out += String.fromCharCode((n >> 8) & 255);
		if (clean[i + 3] !== undefined) out += String.fromCharCode(n & 255);
	}
	return out;
});

export class AbortSignalShim {
	aborted = false;
	reason: unknown = undefined;
	onabort: ((event: { type: "abort" }) => void) | null = null;
	#listeners: ((event: { type: "abort" }) => void)[] = [];
	addEventListener(type: string, listener: (event: { type: "abort" }) => void) {
		if (type === "abort") this.#listeners.push(listener);
	}
	removeEventListener(type: string, listener: (event: { type: "abort" }) => void) {
		if (type === "abort") this.#listeners = this.#listeners.filter((l) => l !== listener);
	}
	throwIfAborted() {
		if (this.aborted) throw this.reason;
	}
	abort(reason?: unknown) {
		if (this.aborted) return;
		this.aborted = true;
		this.reason = reason ?? new Error("This operation was aborted");
		this.onabort?.({ type: "abort" });
		for (const listener of this.#listeners) listener({ type: "abort" });
	}
	static timeout(ms: number) {
		const signal = new AbortSignalShim();
		setTimer(() => signal.abort(new Error("The operation timed out")), ms, false);
		return signal;
	}
}
define("AbortSignal", AbortSignalShim);
define(
	"AbortController",
	class AbortController {
		readonly signal = new AbortSignalShim();
		abort(reason?: unknown) {
			this.signal.abort(reason);
		}
	},
);

export class URLSearchParamsShim {
	#pairs: [string, string][] = [];
	constructor(init: string | Record<string, string> | [string, string][] = "") {
		if (typeof init === "string") {
			for (const part of init.replace(/^\?/, "").split("&")) {
				if (part === "") continue;
				const [key = "", value = ""] = part.split(/=(.*)/s);
				this.#pairs.push([decode(key), decode(value)]);
			}
		} else {
			for (const [key, value] of Array.isArray(init) ? init : Object.entries(init)) this.#pairs.push([key, String(value)]);
		}
	}
	get(key: string) {
		return this.#pairs.find(([k]) => k === key)?.[1] ?? null;
	}
	getAll(key: string) {
		return this.#pairs.filter(([k]) => k === key).map(([, v]) => v);
	}
	has(key: string) {
		return this.#pairs.some(([k]) => k === key);
	}
	set(key: string, value: string) {
		this.delete(key);
		this.#pairs.push([key, String(value)]);
	}
	append(key: string, value: string) {
		this.#pairs.push([key, String(value)]);
	}
	delete(key: string) {
		this.#pairs = this.#pairs.filter(([k]) => k !== key);
	}
	forEach(each: (value: string, key: string) => void) {
		for (const [k, v] of this.#pairs) each(v, k);
	}
	entries() {
		return this.#pairs[Symbol.iterator]();
	}
	[Symbol.iterator]() {
		return this.entries();
	}
	toString() {
		return this.#pairs.map(([k, v]) => `${encode(k)}=${encode(v)}`).join("&");
	}
}
const encode = (s: string) => encodeURIComponent(s).replace(/%20/g, "+");
const decode = (s: string) => decodeURIComponent(s.replace(/\+/g, " "));
define("URLSearchParams", URLSearchParamsShim);

/** Enough of WHATWG URL for absolute URLs and the relative references APIs build. */
const PARTS = /^([a-zA-Z][a-zA-Z0-9+.-]*:)(?:\/\/([^/?#]*))?([^?#]*)(\?[^#]*)?(#.*)?$/;
const normalize = (path: string) => {
	const out: string[] = [];
	for (const segment of path.split("/")) {
		if (segment === "..") {
			if (out.length > 1) out.pop();
		} else if (segment !== ".") out.push(segment);
	}
	return out.join("/");
};
export class URLShim {
	protocol: string;
	host: string;
	pathname: string;
	hash: string;
	readonly searchParams: URLSearchParamsShim;
	constructor(input: string | URLShim, base?: string | URLShim) {
		const text = String(input);
		let parts = PARTS.exec(text);
		if (parts === null) {
			if (base === undefined) throw new TypeError(`Invalid URL: ${text}`);
			const b = new URLShim(base);
			const root = `${b.protocol}//${b.host}`;
			const resolved = text.startsWith("//")
				? b.protocol + text
				: text.startsWith("/")
					? root + text
					: text.startsWith("?")
						? root + b.pathname + text
						: text.startsWith("#")
							? root + b.pathname + b.search + text
							: root + normalize(b.pathname.replace(/[^/]*$/, "") + text);
			parts = PARTS.exec(resolved);
			if (parts === null) throw new TypeError(`Invalid URL: ${text}`);
		}
		const [, protocol = "", host = "", pathname = "", search = "", hash = ""] = parts;
		this.protocol = protocol.toLowerCase();
		this.host = host.toLowerCase();
		this.pathname = host !== "" && pathname === "" ? "/" : normalize(pathname);
		this.searchParams = new URLSearchParamsShim(search);
		this.hash = hash === "#" ? "" : hash;
	}
	get search() {
		const query = this.searchParams.toString();
		return query === "" ? "" : `?${query}`;
	}
	set search(value: string) {
		const fresh = new URLSearchParamsShim(value);
		for (const key of [...this.searchParams].map(([k]) => k)) this.searchParams.delete(key);
		for (const [k, v] of fresh) this.searchParams.append(k, v);
	}
	get hostname() {
		return this.host.replace(/:\d+$/, "");
	}
	get port() {
		return /:(\d+)$/.exec(this.host)?.[1] ?? "";
	}
	get origin() {
		return this.host === "" ? "null" : `${this.protocol}//${this.host}`;
	}
	get href() {
		return `${this.protocol}${this.host === "" ? "" : `//${this.host}`}${this.pathname}${this.search}${this.hash}`;
	}
	toString() {
		return this.href;
	}
	toJSON() {
		return this.href;
	}
}
define("URL", URLShim);

export class HeadersShim {
	#map = new Map<string, string>();
	constructor(init?: Record<string, string> | [string, string][] | HeadersShim) {
		if (init instanceof HeadersShim) init.forEach((v, k) => this.set(k, v));
		else if (init !== undefined) for (const [k, v] of Array.isArray(init) ? init : Object.entries(init)) this.append(k, v);
	}
	get(name: string) {
		return this.#map.get(name.toLowerCase()) ?? null;
	}
	has(name: string) {
		return this.#map.has(name.toLowerCase());
	}
	set(name: string, value: string) {
		this.#map.set(name.toLowerCase(), String(value));
	}
	append(name: string, value: string) {
		const key = name.toLowerCase();
		const prior = this.#map.get(key);
		this.#map.set(key, prior === undefined ? String(value) : `${prior}, ${value}`);
	}
	delete(name: string) {
		this.#map.delete(name.toLowerCase());
	}
	forEach(each: (value: string, name: string) => void) {
		for (const [k, v] of this.#map) each(v, k);
	}
	entries() {
		return this.#map.entries();
	}
	[Symbol.iterator]() {
		return this.entries();
	}
}
define("Headers", HeadersShim);

/** A response whose body is text, which is all the worker returns inline. */
export class ResponseShim {
	readonly headers: HeadersShim;
	readonly status: number;
	readonly statusText: string;
	readonly url: string;
	readonly redirected = false;
	readonly type = "basic";
	bodyUsed = false;
	readonly #text: string;
	constructor(body: string | null = null, init: { status?: number; statusText?: string; headers?: Record<string, string>; url?: string } = {}) {
		this.#text = body ?? "";
		this.status = init.status ?? 200;
		this.statusText = init.statusText ?? "";
		this.headers = new HeadersShim(init.headers ?? {});
		this.url = init.url ?? "";
	}
	get ok() {
		return this.status >= 200 && this.status < 300;
	}
	async text() {
		this.bodyUsed = true;
		return this.#text;
	}
	async json() {
		return JSON.parse(await this.text());
	}
	async arrayBuffer() {
		return new TextEncoderShim().encode(await this.text()).buffer;
	}
	clone() {
		return new ResponseShim(this.#text, { status: this.status, statusText: this.statusText, headers: Object.fromEntries(this.headers), url: this.url });
	}
}
define("Response", ResponseShim);

type FetchInit = {
	method?: string;
	headers?: Record<string, string> | [string, string][] | HeadersShim;
	body?: string | Uint8Array | ArrayBuffer | URLSearchParamsShim | null;
	signal?: AbortSignalShim;
	redirect?: "follow" | "manual" | "error";
};

/**
 * fetch over the worker's HTTP. Bodies travel as text; a binary one fails, so
 * save or send it as a volume file with `http.request` instead.
 */
export async function fetchShim(input: string | URLShim | { url: string }, init: FetchInit = {}): Promise<ResponseShim> {
	init.signal?.throwIfAborted();
	const url = typeof input === "object" && "url" in input ? input.url : String(input);
	const headers = Object.fromEntries(new HeadersShim(init.headers ?? {}));
	let body: string | undefined;
	if (init.body instanceof URLSearchParamsShim) {
		body = init.body.toString();
		headers["content-type"] ??= "application/x-www-form-urlencoded;charset=UTF-8";
	} else if (typeof init.body === "string") body = init.body;
	else if (init.body != null) {
		try {
			body = new TextDecoderShim("utf-8", { fatal: true }).decode(init.body);
		} catch {
			throw new TypeError("fetch: a binary body cannot be sent; send it as a volume file with http.request");
		}
	}
	try {
		const response = await request({
			url,
			method: (init.method?.toUpperCase() ?? "GET") as "GET",
			headers,
			...(body === undefined ? {} : { body }),
			followRedirects: init.redirect !== "manual",
		});
		return new ResponseShim(response.text ?? "", { status: response.status, headers: response.headers, url });
	} catch (error) {
		throw error instanceof HttpError ? new TypeError(`fetch failed: ${error.message}`, { cause: error }) : error;
	}
}
define("fetch", fetchShim);
