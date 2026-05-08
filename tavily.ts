import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { activityMonitor } from "./activity.js";
import type { ExtractedContent } from "./extract.js";

const TAVILY_API_URL = "https://api.tavily.com/search";
const CONFIG_PATH = join(homedir(), ".pi", "web-search.json");

interface WebSearchConfig {
	tavilyApiKey?: unknown;
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
	return normalizeApiKey(process.env.TAVILY_API_KEY) ?? normalizeApiKey(config.tavilyApiKey);
}

const RECENCY_DAYS: Record<string, number> = {
	day: 1,
	week: 7,
	month: 30,
	year: 365,
};

function mapDomainFilter(domainFilter: string[] | undefined): { include_domains?: string[]; exclude_domains?: string[] } {
	if (!domainFilter?.length) return {};
	const includeDomains = domainFilter
		.filter(d => !d.startsWith("-") && d.trim().length > 0)
		.map(d => d.trim());
	const excludeDomains = domainFilter
		.filter(d => d.startsWith("-"))
		.map(d => d.slice(1).trim())
		.filter(Boolean);
	return {
		...(includeDomains.length ? { include_domains: includeDomains } : {}),
		...(excludeDomains.length ? { exclude_domains: excludeDomains } : {}),
	};
}

export function isTavilyAvailable(): boolean {
	return !!getApiKey();
}

export async function searchWithTavily(query: string, options: SearchOptions = {}): Promise<SearchResponse> {
	const apiKey = getApiKey();
	if (!apiKey) {
		throw new Error(
			"Tavily API key not found. Either:\n" +
			`  1. Create ${CONFIG_PATH} with { "tavilyApiKey": "your-key" }\n` +
			"  2. Set TAVILY_API_KEY environment variable\n" +
			"Get a key at https://app.tavily.com/"
		);
	}

	const activityId = activityMonitor.logStart({ type: "api", query });

	const numResults = Math.min(options.numResults ?? 5, 20);
	const domainFilters = mapDomainFilter(options.domainFilter);
	const days = options.recencyFilter ? RECENCY_DAYS[options.recencyFilter] : undefined;

	const requestBody: Record<string, unknown> = {
		api_key: apiKey,
		query,
		search_depth: "basic",
		include_answer: true,
		max_results: numResults,
		...domainFilters,
		...(days !== undefined ? { days } : {}),
	};

	let response: Response;
	try {
		response = await fetch(TAVILY_API_URL, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify(requestBody),
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
		throw new Error(`Tavily API error ${response.status}: ${errorText}`);
	}

	let data: Record<string, unknown>;
	try {
		data = await response.json();
	} catch (err) {
		activityMonitor.logComplete(activityId, response.status);
		const message = err instanceof Error ? err.message : String(err);
		throw new Error(`Tavily API returned invalid JSON: ${message}`);
	}

	const answer = typeof data.answer === "string" ? data.answer : "";
	const rawResults = Array.isArray(data.results) ? data.results : [];

	const results: SearchResult[] = [];
	for (let i = 0; i < rawResults.length; i++) {
		const item = rawResults[i] as Record<string, unknown>;
		const url = typeof item.url === "string" ? item.url : "";
		if (!url) continue;
		results.push({
			title: (typeof item.title === "string" && item.title) || `Source ${i + 1}`,
			url,
			snippet: typeof item.content === "string" ? item.content : "",
		});
	}

	activityMonitor.logComplete(activityId, response.status);
	return { answer, results };
}
