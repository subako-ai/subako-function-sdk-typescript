// The Standard Schema and Standard JSON Schema interfaces
// (https://standardschema.dev), copied as the spec intends, so zod, valibot,
// arktype and the like work without this package depending on any of them.

export interface StandardSchemaV1<Input = unknown, Output = Input> {
	readonly "~standard": StandardSchemaV1.Props<Input, Output>;
}

export declare namespace StandardSchemaV1 {
	interface Props<Input = unknown, Output = Input> {
		readonly version: 1;
		readonly vendor: string;
		readonly validate: (value: unknown) => Result<Output> | Promise<Result<Output>>;
		readonly types?: { readonly input: Input; readonly output: Output } | undefined;
	}
	type Result<Output> = { readonly value: Output; readonly issues?: undefined } | { readonly issues: ReadonlyArray<Issue> };
	interface Issue {
		readonly message: string;
		readonly path?: ReadonlyArray<PropertyKey | { readonly key: PropertyKey }> | undefined;
	}
}

export interface StandardJSONSchemaV1<Input = unknown, Output = Input> {
	readonly "~standard": {
		readonly jsonSchema: {
			readonly input: (options: { readonly target: string }) => Record<string, unknown>;
			readonly output: (options: { readonly target: string }) => Record<string, unknown>;
		};
		readonly types?: { readonly input: Input; readonly output: Output } | undefined;
	};
}

/** A schema that validates and also describes itself as JSON Schema, as zod 4 does. */
export type Schema<Input = unknown, Output = Input> = StandardSchemaV1<Input, Output> & StandardJSONSchemaV1<Input, Output>;

/** A JSON Schema written out, which describes the value but checks nothing. */
export type JsonSchema = { readonly type: "object"; readonly [key: string]: unknown };

/** What a tool's `run` receives: the schema's parsed value. */
export type InputOf<S> = S extends Schema<unknown, infer Output> ? Output : Record<string, unknown>;

/** What a tool's `run` returns: what the schema accepts, or with none, an object, text, or nothing. */
export type OutputOf<S> = S extends Schema<infer Input, unknown>
	? Input
	: S extends JsonSchema
		? Record<string, unknown>
		: Record<string, unknown> | string | undefined;

export function isSchema(schema: Schema | JsonSchema): schema is Schema {
	return typeof (schema as Partial<Schema>)["~standard"]?.validate === "function";
}

/** The JSON Schema `schema` describes the tool's input or output with. */
export function jsonSchemaOf(schema: Schema | JsonSchema, side: "input" | "output"): Record<string, unknown> {
	if (!isSchema(schema)) return schema;
	const { $schema: _, ...described } = schema["~standard"].jsonSchema[side]({ target: "draft-2020-12" });
	return described;
}

/** The value `schema` makes of `value`, or why it refuses it. */
export async function check(schema: Schema, value: unknown): Promise<{ value: unknown } | { refusal: string }> {
	const result = await schema["~standard"].validate(value);
	if (result.issues === undefined) return { value: result.value };
	return { refusal: result.issues.map(describe).join("; ") };
}

function describe(issue: StandardSchemaV1.Issue): string {
	const path = (issue.path ?? []).map((segment) => String(typeof segment === "object" ? segment.key : segment)).join(".");
	return path === "" ? issue.message : `${path}: ${issue.message}`;
}
