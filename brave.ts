import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { activityMonitor } from "./activity.js";
import type { ExtractedContent } from "./extract.js";

const BRAVE_API_URL = "https://api.search.brave.com/res/v1/web/search";
const CONFIG_PATH = join(homedir(), ".pi", "web-search.json");

interface WebSearchConfig {
	braveApiKey?: unknown;
}

export interface SearchResult {
	title: string;
	url: string;
	snippet: string;
}

export interface SearchResponse {
	answer: string;
	results: SearchResult[];
	inlineContent?: ExtractedContent[];
}

export interface SearchOptions {
	numResults?: number;
	recencyFilter?: "day" | "week" | "month" | "year";
	domainFilter?: string[];
	signal?: AbortSignal;
}

let cachedConfig: WebSearchConfig | null = null;

function loadConfig(): WebSearchConfig {
	if (cachedConfig) return cachedConfig;
	if (!existsSync(CONFIG_PATH)) {
		cachedConfig = {};
		return cachedConfig;
	}

	const content = readFileSync(CONFIG_PATH, "utf-8");
	try {
		cachedConfig = JSON.parse(content) as WebSearchConfig;
		return cachedConfig;
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		throw new Error(`Failed to parse ${CONFIG_PATH}: ${message}`);
	}
}

export function normalizeApiKey(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const normalized = value.trim();
	return normalized.length > 0 ? normalized : null;
}

function getApiKey(): string | null {
	const config = loadConfig();
	return normalizeApiKey(process.env.BRAVE_API_KEY) ?? normalizeApiKey(config.braveApiKey);
}

const RECENCY_FRESHNESS: Record<string, string> = {
	day: "pd",     // past day
	week: "pw",    // past week
	month: "pm",   // past month
	year: "py",    // past year
};

export function isBraveAvailable(): boolean {
	return !!getApiKey();
}

export async function searchWithBrave(query: string, options: SearchOptions = {}): Promise<SearchResponse> {
	const apiKey = getApiKey();
	if (!apiKey) {
		throw new Error(
			"Brave API key not found. Either:\n" +
			`  1. Create ${CONFIG_PATH} with { "braveApiKey": "your-key" }\n` +
			"  2. Set BRAVE_API_KEY environment variable\n" +
			"Get a key at https://brave.com/search/api/"
		);
	}

	const activityId = activityMonitor.logStart({ type: "api", query });

	const count = Math.min(options.numResults ?? 5, 20);
	const params = new URLSearchParams({ q: query, count: String(count) });

	if (options.recencyFilter) {
		const freshness = RECENCY_FRESHNESS[options.recencyFilter];
		if (freshness) params.set("freshness", freshness);
	}

	if (options.domainFilter?.length) {
		for (const d of options.domainFilter) {
			const siteOp = d.startsWith("-") ? `-site:${d.slice(1)}` : `site:${d}`;
			params.append("q", siteOp);
		}
	}

	let response: Response;
	try {
		response = await fetch(`${BRAVE_API_URL}?${params.toString()}`, {
			method: "GET",
			headers: {
				"Accept": "application/json",
				"X-Subscription-Token": apiKey,
			},
			signal: options.signal,
		});
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		if (message.toLowerCase().includes("abort")) {
			activityMonitor.logComplete(activityId, 0);
		} else {
			activityMonitor.logError(activityId, message);
		}
		throw err;
	}

	if (!response.ok) {
		activityMonitor.logComplete(activityId, response.status);
		const errorText = await response.text();
		throw new Error(`Brave API error ${response.status}: ${errorText}`);
	}

	let data: Record<string, unknown>;
	try {
		data = await response.json();
	} catch (err) {
		activityMonitor.logComplete(activityId, response.status);
		const message = err instanceof Error ? err.message : String(err);
		throw new Error(`Brave API returned invalid JSON: ${message}`);
	}

	const webResults = (data.web as Record<string, unknown> | undefined)?.results;
	const rawResults = Array.isArray(webResults) ? webResults : [];

	const results: SearchResult[] = [];
	for (let i = 0; i < rawResults.length; i++) {
		const item = rawResults[i] as Record<string, unknown>;
		const url = typeof item.url === "string" ? item.url : "";
		if (!url) continue;
		results.push({
			title: (typeof item.title === "string" && item.title) || `Source ${i + 1}`,
			url,
			snippet: typeof item.description === "string" ? item.description : "",
		});
	}

	const answer = results.length > 0
		? results.map(r => `${r.title}\n${r.url}`).join("\n\n")
		: "";

	activityMonitor.logComplete(activityId, response.status);
	return { answer, results };
}
