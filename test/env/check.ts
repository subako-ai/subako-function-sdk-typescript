// Compiled with ES2023 and the env types alone: the SDK needs no global
// beyond them, its shims match what env declares, and DOM and Node globals
// are type errors.
import "../../src/index.js";

import {
	AbortSignalShim,
	fetchShim,
	HeadersShim,
	ResponseShim,
	TextDecoderShim,
	TextEncoderShim,
	URLSearchParamsShim,
	URLShim,
} from "../../src/globals.js";

fetchShim satisfies typeof fetch;
new ResponseShim("") satisfies Response;
new HeadersShim() satisfies Headers;
new URLShim("https://example.com/") satisfies URL;
new URLSearchParamsShim() satisfies URLSearchParams;
new TextEncoderShim() satisfies TextEncoder;
new TextDecoderShim() satisfies TextDecoder;
new AbortSignalShim() satisfies AbortSignal;

// @ts-expect-error: no DOM
document.title;
// @ts-expect-error: no Node
process.env;
// @ts-expect-error: no Node
Buffer.from("");
// @ts-expect-error: no Node modules
await import("node:fs");
