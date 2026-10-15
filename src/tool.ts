import { Answer, type ContentBlock } from "./answer.js";
import { check, type InputOf, isSchema, type JsonSchema, jsonSchemaOf, type OutputOf, type Schema } from "./schema.js";

export interface ToolDefinition<I extends Schema | JsonSchema, O extends Schema | JsonSchema | undefined> {
	/** What the model calls the tool by. */
	name: string;
	/** What the model reads to decide when to call it. */
	description: string;
	/** The arguments, as a schema that validates (zod and the like) or a JSON Schema. */
	input?: I;
	/** The structured value `run` returns, checked before it is sent. */
	output?: O;
	/**
	 * Answers a call. A thrown error becomes a result the model reads with
	 * `isError` set; return an {@link Answer} to show it more than the value.
	 */
	run(input: InputOf<I>): OutputOf<O> | Answer<OutputOf<O>> | Promise<OutputOf<O> | Answer<OutputOf<O>>>;
}

/** A tool as `tools/list` names it and `tools/call` runs it. */
export interface Tool {
	readonly name: string;
	/** The entry `tools/list` carries. */
	listing(): Record<string, unknown>;
	/** MCP's `CallToolResult` for a call with `args`. */
	call(args: unknown): Promise<CallToolResult>;
}

export interface CallToolResult {
	content: ContentBlock[];
	structuredContent?: Record<string, unknown>;
	isError?: true;
}

const NO_ARGUMENTS: JsonSchema = { type: "object", properties: {} };

export function tool<I extends Schema | JsonSchema = JsonSchema, O extends Schema | JsonSchema | undefined = undefined>(
	definition: ToolDefinition<I, O>,
): Tool {
	const input: Schema | JsonSchema = definition.input ?? NO_ARGUMENTS;
	const output: Schema | JsonSchema | undefined = definition.output;
	const inputSchema = jsonSchemaOf(input, "input");
	if (inputSchema.type !== "object") {
		throw new TypeError(`tool ${definition.name}: its input must be an object schema`);
	}
	const listing = {
		name: definition.name,
		description: definition.description,
		inputSchema,
		...(output === undefined ? {} : { outputSchema: jsonSchemaOf(output, "output") }),
	};
	return {
		name: definition.name,
		listing: () => listing,
		call: async (args) => {
			try {
				let parsed: unknown = args ?? {};
				if (isSchema(input)) {
					const checked = await check(input, parsed);
					if ("refusal" in checked) return failure(`Invalid arguments: ${checked.refusal}`);
					parsed = checked.value;
				}
				const returned = await definition.run(parsed as InputOf<I>);
				const [value, extra] = returned instanceof Answer ? [returned.value, returned.content] : [returned, []];
				let sent: unknown = value;
				if (output !== undefined && isSchema(output)) {
					const checked = await check(output, value);
					if ("refusal" in checked) return failure(`The tool's output does not match its schema: ${checked.refusal}`);
					sent = checked.value;
				}
				return { ...reading(sent), content: [...reading(sent).content, ...extra] };
			} catch (error) {
				return failure(error instanceof Error ? error.message : String(error));
			}
		},
	};
}

/** How the model reads `value`: a string as it is, anything else as JSON, an object also as structured content. */
function reading(value: unknown): CallToolResult {
	switch (typeof value) {
		case "undefined":
			return { content: [] };
		case "string":
			return { content: [{ type: "text", text: value }] };
		default: {
			const text: { type: "text"; text: string } = { type: "text", text: JSON.stringify(value) };
			const structured = value !== null && typeof value === "object" && !Array.isArray(value);
			return structured
				? { content: [text], structuredContent: value as Record<string, unknown> }
				: { content: [text] };
		}
	}
}

function failure(message: string): CallToolResult {
	return { content: [{ type: "text", text: message }], isError: true };
}
