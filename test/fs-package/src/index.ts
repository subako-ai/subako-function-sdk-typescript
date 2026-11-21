// What `fs` reports at a path, answered from the shipped runtime rather than
// the Node host the unit tests use.
import { fs, serve, tool } from "@subako-ai/function-sdk";

const look = tool({
	name: "look",
	description: "Whether something is at a path, and its stat.",
	input: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
	run: ({ path }) => ({ exists: fs.exists(path as string), stat: fs.stat(path as string) }),
});

serve([look]);
