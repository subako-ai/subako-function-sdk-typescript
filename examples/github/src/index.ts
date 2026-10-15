// A Subako function package that reads GitHub: a repository's stats, its open
// issues, and an owner's avatar. Requests go through the worker, which
// attaches a GitHub token when the agent's grant holds one.
import { answer, http, serve, tool } from "@subako-ai/function-sdk";
import { z } from "zod";

/** The GitHub API's answer at `path`, or an error the model can act on. */
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

const repository = z.object({
	owner: z.string().describe("the user or organization, e.g. microsoft"),
	repo: z.string().describe("the repository name, e.g. typescript"),
});

const repo = tool({
	name: "repo",
	description: "A GitHub repository's description, stars, forks and open issue count.",
	input: repository,
	output: z.object({
		full_name: z.string(),
		description: z.string().nullable(),
		stars: z.number(),
		forks: z.number(),
		open_issues: z.number(),
		url: z.string(),
	}),
	run: async ({ owner, repo }) => {
		const found = (await github(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`)) as Repository;
		return {
			full_name: found.full_name,
			description: found.description,
			stars: found.stargazers_count,
			forks: found.forks_count,
			open_issues: found.open_issues_count,
			url: found.html_url,
		};
	},
});

const issues = tool({
	name: "issues",
	description: "A GitHub repository's open issues, newest first, optionally only those with a label.",
	input: repository.extend({
		label: z.string().optional().describe("only issues with this label"),
		limit: z.number().int().min(1).max(50).default(10).describe("how many to return"),
	}),
	output: z.object({
		issues: z.array(z.object({ number: z.number(), title: z.string(), author: z.string(), comments: z.number(), url: z.string() })),
	}),
	run: async ({ owner, repo, label, limit }) => {
		const query = new URLSearchParams({ state: "open", per_page: String(limit) });
		if (label !== undefined) query.set("labels", label);
		const listed = (await github(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues?${query}`)) as {
			number: number;
			title: string;
			user: { login: string };
			comments: number;
			html_url: string;
			pull_request?: unknown;
		}[];
		return {
			// The issues API lists pull requests too.
			issues: listed
				.filter((issue) => issue.pull_request === undefined)
				.map((issue) => ({ number: issue.number, title: issue.title, author: issue.user.login, comments: issue.comments, url: issue.html_url })),
		};
	},
});

const avatar = tool({
	name: "avatar",
	description: "Show a GitHub user's or organization's avatar.",
	input: z.object({ owner: z.string().describe("the user or organization") }),
	output: z.object({ path: z.string(), bytes: z.number() }),
	run: async ({ owner }) => {
		// The image is binary, so the worker saves it to the volume rather than returning it.
		const path = `/volume/tmp/avatar-${encodeURIComponent(owner)}.png`;
		const response = await http.request({ url: `https://github.com/${encodeURIComponent(owner)}.png?size=200`, saveTo: path });
		if (response.status !== 200) throw new Error(`GitHub answered ${response.status} for ${owner}'s avatar`);
		return answer({ path, bytes: response.file?.bytes ?? 0 }).withImageFile(path);
	},
});

serve([repo, issues, avatar]);
