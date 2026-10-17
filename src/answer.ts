/** A content block MCP's `CallToolResult` carries. */
export type ContentBlock =
	| { type: "text"; text: string }
	| { type: "image"; data: string; mimeType: string }
	| { type: "resource_link"; uri: string; name: string };

/**
 * A tool's value with more for the model to read after it. The model reads
 * the value as JSON first, then each block in the order they were added.
 *
 * ```ts
 * return answer(chart).withImageFile(chart.path);
 * ```
 */
export class Answer<T> {
	constructor(
		readonly value: T,
		readonly content: readonly ContentBlock[] = [],
	) {}

	withText(text: string): Answer<T> {
		return new Answer(this.value, [...this.content, { type: "text", text }]);
	}

	/**
	 * Shows the model the image at `path`, an absolute path under `/volume`.
	 * Core reads the file once the call returns, so it must still be there.
	 */
	withImageFile(path: string): Answer<T> {
		return new Answer(this.value, [...this.content, imageFile(path)]);
	}

	/** An image's bytes, base64-encoded; a large one goes as a file instead. */
	withImage(data: string, mimeType: string): Answer<T> {
		return new Answer(this.value, [...this.content, { type: "image", data, mimeType }]);
	}
}

export function answer<T>(value: T): Answer<T> {
	return new Answer(value);
}

/** A `resource_link` Core shows the model as the image at `path`. */
export function imageFile(path: string): ContentBlock {
	return { type: "resource_link", uri: volumeUri(path), name: path.slice(path.lastIndexOf("/") + 1) };
}

/**
 * `volume:///` and the path beneath `/volume`, each segment percent-encoded
 * as the Rust SDK's `volume_uri` does; Core shows anything outside the volume
 * as a line naming the link.
 */
export function volumeUri(path: string): string {
	const encode = (p: string) => p.split("/").map(encodeSegment).join("/");
	return path.startsWith("/volume/") ? `volume:///${encode(path.slice("/volume/".length))}` : `file://${encode(path)}`;
}

/** Keeps ASCII letters, digits and -._~ and percent-encodes every other byte. */
function encodeSegment(segment: string): string {
	return encodeURIComponent(segment).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}
