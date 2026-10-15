import { host } from "./host.js";

export interface HttpRequest {
	url: string;
	/** GET unless set. */
	method?: "GET" | "HEAD" | "POST" | "PUT" | "PATCH" | "DELETE" | "OPTIONS";
	headers?: Record<string, string>;
	/** Text as it is, `{ json }` serialized, or `{ file }` streamed from the volume. */
	body?: string | { json: unknown } | { file: string };
	/** Saves the response body to this volume file instead of returning it as text. */
	saveTo?: string;
	/** True unless set; each hop is checked like the first. */
	followRedirects?: boolean;
	timeoutMs?: number;
}

export interface HttpResponse {
	status: number;
	/** Lowercase names; repeated headers joined with ", ". */
	headers: Record<string, string>;
	/** The body, unless it was saved to a file. */
	text?: string;
	/** Where the body was saved, when `saveTo` was set. */
	file?: { path: string; bytes: number };
}

export type HttpErrorKind =
	| "invalid_request"
	| "host_not_allowed"
	| "forbidden_destination"
	| "credential_header"
	| "credential_unavailable"
	| "too_many_redirects"
	| "timeout"
	| "too_large"
	| "not_text"
	| "write_budget"
	| "bad_path"
	| "connection"
	| "abi";

/** Why a request produced no response, in a message written for the model. */
export class HttpError extends Error {
	constructor(
		readonly kind: HttpErrorKind,
		message: string,
	) {
		super(message);
		this.name = "HttpError";
	}
}

type Wire =
	| { ok: { status: number; headers: Record<string, string>; body: { type: "inline"; text: string } | { type: "file"; path: string; bytes: number } } }
	| { error: { kind: HttpErrorKind; message: string } };

/**
 * Sends `request` through the worker: https only, to hosts the agent's grant
 * allows, with any credential the grant names for the origin attached on the
 * way out. Rejects with an {@link HttpError}.
 */
export async function request(request: HttpRequest): Promise<HttpResponse> {
	const body = request.body;
	const wire = {
		method: request.method ?? "GET",
		url: request.url,
		headers: request.headers ?? {},
		...(body === undefined
			? {}
			: {
					body:
						typeof body === "string"
							? { type: "text", text: body }
							: "json" in body
								? { type: "json", json: body.json }
								: { type: "file", path: body.file },
				}),
		output: request.saveTo === undefined ? { type: "inline" } : { type: "file", path: request.saveTo },
		...(request.followRedirects === undefined ? {} : { follow_redirects: request.followRedirects }),
		...(request.timeoutMs === undefined ? {} : { timeout_ms: Math.max(1, Math.ceil(request.timeoutMs)) }),
	};
	let answer: Wire;
	try {
		answer = JSON.parse(host().http(JSON.stringify(wire)));
	} catch (error) {
		throw new HttpError("abi", error instanceof Error ? error.message : String(error));
	}
	if ("error" in answer) throw new HttpError(answer.error.kind, answer.error.message);
	const { status, headers, body: received } = answer.ok;
	return received.type === "inline"
		? { status, headers, text: received.text }
		: { status, headers, file: { path: received.path, bytes: received.bytes } };
}

export const http = {
	request,
	/** Fetches `url`, its body as text. */
	get: (url: string, headers?: Record<string, string>) => request(headers === undefined ? { url } : { url, headers }),
};
