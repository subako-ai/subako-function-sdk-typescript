# @subako-ai/function-sdk

Write Subako function packages in TypeScript. Each tool becomes a function an agent can call.

```ts
import { serve, tool } from "@subako-ai/function-sdk";
import { z } from "zod";

const repo = tool({
	name: "repo",
	description: "A GitHub repository's stars.",
	input: z.object({ owner: z.string(), repo: z.string() }),
	output: z.object({ stars: z.number() }),
	run: async ({ owner, repo }) => {
		const found = await (await fetch(`https://api.github.com/repos/${owner}/${repo}`)).json();
		return { stars: found.stargazers_count };
	},
});

serve([repo]);
```

- Schemas are any [Standard Schema](https://standardschema.dev) that also emits JSON Schema (zod 4, and others), or a plain JSON Schema.
- `fetch` goes through the worker, which applies the function's network and credentials. `http.request` also sends and saves volume files.
- `answer(value).withImageFile(path)` shows the model an image from `/volume`; `fs` reads and writes files.
- For TypeScript, `"lib": ["ES2023"], "types": ["@subako-ai/function-sdk/env"]` declares exactly the globals the runtime provides, so DOM and Node APIs are type errors.
- Prefer the official MCP SDK? `serveMcp` from `@subako-ai/function-sdk/mcp` serves an `McpServer`.

Put a `subako-package.json` (`{"abi": 1, "name": ..., "description": ...}`) beside `src/index.ts`, then:

```sh
npx @subako-ai/function-sdk build   # writes dist/
npx @subako-ai/function-sdk pack    # packs dist/ into <name>.tar.gz
subako function create <name>.tar.gz   # or: subako function push <function-id> <name>.tar.gz
```

See [examples/github](examples/github) and [examples/github-mcp](examples/github-mcp).

## License

Licensed under either of [Apache License, Version 2.0](LICENSE-APACHE) or [MIT license](LICENSE-MIT) at your option.
