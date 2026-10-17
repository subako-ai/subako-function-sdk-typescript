import "./host.js";

import { describe, expect, it } from "vitest";

import { imageFile } from "../src/answer.js";
import { fetchShim, HeadersShim, TextDecoderShim, URLSearchParamsShim, URLShim } from "../src/globals.js";
import { HttpError, http } from "../src/http.js";
import { answerHttp, httpSent } from "./host.js";

const ok = (text: string, headers: Record<string, string> = {}) => ({
	ok: { status: 200, headers, body: { type: "inline", text } },
});

describe("http.request", () => {
	it("sends the worker's wire shape and reads its answer", async () => {
		answerHttp(() => ({
			ok: { status: 201, headers: { "x-a": "1" }, body: { type: "file", path: "/volume/out.bin", bytes: 3 } },
		}));
		const response = await http.request({
			url: "https://api.example.com/things",
			method: "POST",
			body: { json: { n: 1 } },
			saveTo: "/volume/out.bin",
			timeoutMs: 1500.2,
			followRedirects: false,
		});
		expect(httpSent.at(-1)).toEqual({
			method: "POST",
			url: "https://api.example.com/things",
			headers: {},
			body: { type: "json", json: { n: 1 } },
			output: { type: "file", path: "/volume/out.bin" },
			follow_redirects: false,
			timeout_ms: 1501,
		});
		expect(response).toEqual({ status: 201, headers: { "x-a": "1" }, file: { path: "/volume/out.bin", bytes: 3 } });
	});

	it("rejects with the worker's refusal", async () => {
		answerHttp(() => ({ error: { kind: "host_not_allowed", message: "this function may not reach x.test" } }));
		const refused = await http.get("https://x.test/").catch((error: unknown) => error);
		expect(refused).toBeInstanceOf(HttpError);
		expect(refused).toMatchObject({ kind: "host_not_allowed", message: "this function may not reach x.test" });
	});
});

describe("fetch", () => {
	it("goes through the worker with its method, headers and text body", async () => {
		answerHttp(() => ok('{"ok":true}', { "content-type": "application/json" }));
		const response = await fetchShim("https://api.example.com/v1?q=1", {
			method: "put",
			headers: { Accept: "application/json", "X-Tag": "a" },
			body: "hello",
		});
		expect(httpSent.at(-1)).toMatchObject({
			method: "PUT",
			url: "https://api.example.com/v1?q=1",
			headers: { accept: "application/json", "x-tag": "a" },
			body: { type: "text", text: "hello" },
			follow_redirects: true,
		});
		expect(response.ok).toBe(true);
		expect(response.headers.get("Content-Type")).toBe("application/json");
		expect(await response.json()).toEqual({ ok: true });
	});

	it("takes a URL, a Headers and a form body", async () => {
		answerHttp(() => ok(""));
		await fetchShim(new URLShim("https://api.example.com/search"), {
			method: "POST",
			headers: new HeadersShim({ "X-Tag": "a" }),
			body: new URLSearchParamsShim({ q: "a b" }),
		});
		expect(httpSent.at(-1)).toMatchObject({
			url: "https://api.example.com/search",
			headers: { "x-tag": "a", "content-type": "application/x-www-form-urlencoded;charset=UTF-8" },
			body: { type: "text", text: "q=a+b" },
		});
	});

	it("refuses a binary body", async () => {
		await expect(
			fetchShim("https://api.example.com/", { method: "POST", body: new Uint8Array([0xff, 0xfe]) }),
		).rejects.toThrow(/binary body/);
	});

	it("rejects with a TypeError when the worker refuses, as fetch does on a network error", async () => {
		answerHttp(() => ({ error: { kind: "connection", message: "connection refused" } }));
		await expect(fetchShim("https://api.example.com/")).rejects.toThrow(
			new TypeError("fetch failed: connection refused"),
		);
	});
});

describe("the web globals", () => {
	it("resolves relative URLs and edits the query", () => {
		const url = new URLShim("../b?x=1#h", "https://api.example.com/a/c/d");
		expect(url.href).toBe("https://api.example.com/a/b?x=1#h");
		url.searchParams.set("y", "a b");
		expect(url.search).toBe("?x=1&y=a+b");
		expect(new URLShim("/repos", "https://api.github.com/x").toString()).toBe("https://api.github.com/repos");
		expect(() => new URLShim("nope")).toThrow(TypeError);
	});

	it("joins repeated headers and reads them case-insensitively", () => {
		const headers = new HeadersShim([
			["Accept", "a"],
			["accept", "b"],
		]);
		expect(headers.get("ACCEPT")).toBe("a, b");
	});

	it("decodes UTF-8, strictly when asked", () => {
		expect(new TextDecoderShim().decode(new Uint8Array([0xe6, 0x9d, 0xb1]))).toBe("東");
		expect(() => new TextDecoderShim("utf-8", { fatal: true }).decode(new Uint8Array([0xff]))).toThrow();
	});
});

describe("imageFile", () => {
	it("links into the volume as the Rust SDK spells it", () => {
		const cases: [string, string][] = [
			["/volume/tmp/chart.png", "volume:///tmp/chart.png"],
			["/volume/a b/グラフ.png", "volume:///a%20b/%E3%82%B0%E3%83%A9%E3%83%95.png"],
			["/volume/x/%2F~_-!.png", "volume:///x/%252F~_-%21.png"],
			["/package/logo.png", "file:///package/logo.png"],
		];
		for (const [path, uri] of cases) expect(imageFile(path)).toMatchObject({ uri });
	});
});
