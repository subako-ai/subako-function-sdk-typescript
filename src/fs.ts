import { host } from "./host.js";

/**
 * The module's files: `/volume` is the session's, shared with the agent and
 * later calls; `/package` holds the package's own assets, read-only.
 */
export const fs = {
	readText: (path: string): string => host().decodeUtf8(new Uint8Array(host().readFile(path))),
	readBytes: (path: string): Uint8Array => new Uint8Array(host().readFile(path)),
	writeText: (path: string, text: string): void => host().writeFile(path, new Uint8Array(host().encodeUtf8(text))),
	writeBytes: (path: string, bytes: Uint8Array): void => host().writeFile(path, bytes),
	appendText: (path: string, text: string): void =>
		host().writeFile(path, new Uint8Array(host().encodeUtf8(text)), true),
	/** Creates the directory and any parents it lacks. */
	mkdir: (path: string): void => host().mkdir(path),
	/** Removes a file, or a directory and everything in it. */
	remove: (path: string): void => host().remove(path),
	/** `{ size, isDirectory }`, or null when nothing is there. */
	stat: (path: string) => host().stat(path),
	exists: (path: string): boolean => host().stat(path) !== null,
	list: (path: string) => host().readDir(path),
};
