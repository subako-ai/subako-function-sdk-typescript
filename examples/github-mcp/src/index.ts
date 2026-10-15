// examples/github, written with the official MCP TypeScript SDK.
import { McpServer } from "@modelcontextprotocol/server";
import { http, imageFile } from "@subako-ai/function-sdk";
import { serveMcp } from "@subako-ai/function-sdk/mcp";
import { z } from "zod";

async function github(path: string): Promise<unknown> {
	const response = await fetch(`https://api.github.com${path}`, { headers: { accept: "application/vnd.github+json" } });
	if (response.status === 404) throw new Error(`GitHub has nothing at ${path}`);
	if (!response.ok) throw new Error(`GitHub answered ${response.status} for ${path}`);
	return response.json();
}

interface Repository {
	full_name: string;
	description: string | null;
	stargazers_count: number;
	forks_count: number;
	open_issues_count: number;
	html_url: string;
}

const repository = {
	owner: z.string().describe("the user or organization, e.g. microsoft"),
	repo: z.string().describe("the repository name, e.g. typescript"),
};

const structured = <T extends Record<string, unknown>>(value: T) => ({
	content: [{ type: "text" as const, text: JSON.stringify(value) }],
	structuredContent: value,
});

serveMcp(() => {
	const server = new McpServer({ name: "github", version: "0.1.0" });
	server.registerTool(
		"repo",
		{
			description: "A GitHub repository's description, stars, forks and open issue count.",
			inputSchema: z.object(repository),
			outputSchema: z.object({
				full_name: z.string(),
				description: z.string().nullable(),
				stars: z.number(),
				forks: z.number(),
				open_issues: z.number(),
				url: z.string(),
			}),
		},
		async ({ owner, repo }) => {
			const found = (await github(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`)) as Repository;
			return structured({
				full_name: found.full_name,
				description: found.description,
				stars: found.stargazers_count,
				forks: found.forks_count,
				open_issues: found.open_issues_count,
				url: found.html_url,
			});
		},
	);
	server.registerTool(
		"issues",
		{
			description: "A GitHub repository's open issues, newest first, optionally only those with a label.",
			inputSchema: z.object({
				...repository,
				label: z.string().optional().describe("only issues with this label"),
				limit: z.number().int().min(1).max(50).default(10).describe("how many to return"),
			}),
		},
		async ({ owner, repo, label, limit }) => {
			const query = new URLSearchParams({ state: "open", per_page: String(limit) });
			if (label !== undefined) query.set("labels", label);
			const listed = (await github(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues?${query}`)) as {
				number: number;
				title: string;
				user: { login: string };
				html_url: string;
				pull_request?: unknown;
			}[];
			return structured({
				issues: listed
					.filter((issue) => issue.pull_request === undefined)
					.map((issue) => ({ number: issue.number, title: issue.title, author: issue.user.login, url: issue.html_url })),
			});
		},
	);
	server.registerTool(
		"avatar",
		{
			description: "Show a GitHub user's or organization's avatar.",
			inputSchema: z.object({ owner: z.string().describe("the user or organization") }),
		},
		async ({ owner }) => {
			const path = `/volume/tmp/avatar-${encodeURIComponent(owner)}.png`;
			const response = await http.request({ url: `https://github.com/${encodeURIComponent(owner)}.png?size=200`, saveTo: path });
			if (response.status !== 200) throw new Error(`GitHub answered ${response.status} for ${owner}'s avatar`);
			const saved = { path, bytes: response.file?.bytes ?? 0 };
			return { ...structured(saved), content: [...structured(saved).content, imageFile(path) as never] };
		},
	);
	return server;
});
