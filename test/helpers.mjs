/**
 * テスト共通ヘルパー
 * - 分離プロセス実行
 * - テスト用ホームディレクトリ作成
 * - モックレスポンスファクトリ
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ─── パス ───────────────────────────────────────────────────────────────
export const GEMINI_SEARCH_TS = new URL("../gemini-search.ts", import.meta.url).pathname;
export const EXA_TS = new URL("../exa.ts", import.meta.url).pathname;
export const TAVILY_TS = new URL("../tavily.ts", import.meta.url).pathname;
export const BRAVE_TS = new URL("../brave.ts", import.meta.url).pathname;

// ─── モックレスポンスファクトリ ──────────────────────────────────────────

export function mcpOk(text = "ok") {
	return {
		url: "mcp.exa.ai", status: 200, contentType: "text/event-stream",
		body: `data: {"jsonrpc":"2.0","id":1,"result":{"content":[{"type":"text","text":"Title: MCP\\nURL: https://mcp.example.com\\nText: ${text}\\n"}]}}\n`,
	};
}

export function mcpFail() {
	return { url: "mcp.exa.ai", status: 500, body: "MCP error" };
}

export function braveOk(text = "Brave result") {
	return {
		url: "api.search.brave.com", status: 200,
		body: JSON.stringify({ web: { results: [{ title: text, url: "https://brave.example.com", description: "desc" }] } }),
	};
}

export function braveFail() {
	return { url: "api.search.brave.com", status: 500, body: "Brave error" };
}

export function tavilyOk(text = "Tavily result") {
	return {
		url: "api.tavily.com", status: 200,
		body: JSON.stringify({ answer: text, results: [] }),
	};
}

export function tavilyFail() {
	return { url: "api.tavily.com", status: 429, body: JSON.stringify({ detail: "Rate limit" }) };
}

export function exaApiOk(text = "Exa API result") {
	return {
		url: "api.exa.ai", status: 200,
		body: JSON.stringify({ answer: text, citations: [{ title: "API Source", url: "https://api.exa.example.com" }] }),
	};
}

export function exaApiFail(status = 500, body = "API error") {
	return { url: "api.exa.ai", status, body: typeof body === "string" ? body : JSON.stringify(body) };
}

// ─── テスト用ホームディレクトリ ──────────────────────────────────────────

export async function createTestHome(prefix = "pi-test-", config = {}) {
	const home = await mkdtemp(join(tmpdir(), prefix));
	await mkdir(join(home, ".pi"), { recursive: true });
	await writeFile(join(home, ".pi", "web-search.json"), JSON.stringify(config));
	return home;
}

export async function writeExaUsage(home, count = 0) {
	await writeFile(join(home, ".pi", "exa-usage.json"), JSON.stringify({
		month: new Date().toISOString().slice(0, 7),
		count,
	}));
}

// ─── 分離プロセス実行 ────────────────────────────────────────────────────

/**
 * 分離プロセスでコードを実行（fetchモック付き）
 */
function runInIsolatedProcess({ sourceFile, home, mocks, envKeys = {}, code, query, provider, options, timeout = 20000 }) {
	const env = { ...process.env, HOME: home, USERPROFILE: home };
	const mockSeq = JSON.stringify(mocks || []);
	const keysStr = JSON.stringify(envKeys);

	// APIキーを環境変数にセット
	const keyAssignments = Object.entries(envKeys)
		.map(([key, value]) => {
			const envVar = keyToEnvVar(key);
			return envVar ? `process.env.${envVar} = ${JSON.stringify(String(value))};` : "";
		})
		.filter(Boolean)
		.join("\n");

	const fullCode = `
		import * as mod from ${JSON.stringify(sourceFile)};
		const search = mod.search;
		const searchWithExa = mod.searchWithExa;
		const hasExaApiKey = mod.hasExaApiKey;
		const isExaAvailable = mod.isExaAvailable;
		const normalizeApiKey = mod.normalizeApiKey;
		const isTavilyAvailable = mod.isTavilyAvailable;
		const searchWithTavily = mod.searchWithTavily;
		const isBraveAvailable = mod.isBraveAvailable;
		const searchWithBrave = mod.searchWithBrave;

		const mocks = ${mockSeq};
		let callIndex = 0;
		${keyAssignments}

		globalThis.fetch = async (url, opts) => {
			const callNum = callIndex++;
			const mock = mocks.find
				? mocks.find(m => url.includes(m.url))
				: mocks[callNum];
			if (!mock) {
				throw new Error("No mock for call #" + callNum + " (url: " + url + ")");
			}
			let label = "unknown";
			if (url.includes("mcp.exa.ai")) label = "mcp";
			else if (url.includes("api.exa.ai")) label = "api";
			else if (url.includes("api.tavily.com")) label = "tavily";
			else if (url.includes("api.search.brave.com")) label = "brave";
			console.error("FETCH #" + callNum + " " + label + " " + url);
			return new Response(mock.body, {
				status: mock.status,
				headers: { "Content-Type": mock.contentType || "application/json" }
			});
		};

		try {
			${code}
		} catch (err) {
			console.log("ERR:" + err.message);
		}
	`;

	return spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", fullCode], {
		encoding: "utf8",
		env,
		timeout,
	});
}

function keyToEnvVar(key) {
	const map = {
		tavilyApiKey: "TAVILY_API_KEY",
		perplexityApiKey: "PERPLEXITY_API_KEY",
		exaApiKey: "EXA_API_KEY",
		geminiApiKey: "GEMINI_API_KEY",
		braveApiKey: "BRAVE_API_KEY",
	};
	return map[key] || null;
}

/**
 * search() を auto provider で実行
 */
export function runSearch(home, mocks, envKeys = {}, query = "test") {
	return runInIsolatedProcess({
		sourceFile: GEMINI_SEARCH_TS,
		home, mocks, envKeys, query,
		code: `
			const result = await search(${JSON.stringify(query)}, { provider: "auto" });
			console.log("OK:" + JSON.stringify({ provider: result.provider, answer: result.answer?.slice(0, 50) }));
		`,
	});
}

/**
 * search() を明示providerで実行
 */
export function runSearchWithProvider(home, provider, mocks, envKeys = {}, query = "test") {
	return runInIsolatedProcess({
		sourceFile: GEMINI_SEARCH_TS,
		home, mocks, envKeys, query, provider,
		code: `
			const result = await search(${JSON.stringify(query)}, { provider: ${JSON.stringify(provider)} });
			console.log("OK:" + JSON.stringify({ provider: result.provider, answer: result.answer?.slice(0, 50) }));
		`,
	});
}

/**
 * searchWithExa() を実行（MCP→APIフォールバックテスト用）
 */
export function runSearchWithExa(home, mocks, query = "test query", envKeys = {}, options = {}) {
	const env = { ...process.env, HOME: home, USERPROFILE: home };
	const mockSeq = JSON.stringify(mocks);
	const queryStr = JSON.stringify(query);
	const optionsStr = JSON.stringify(options);

	// APIキーをファイルと環境変数の両方にセット
	const configEntries = Object.entries(envKeys);
	let configObj = {};
	for (const [key, value] of configEntries) {
		if (key === "exaApiKey") configObj.exaApiKey = value;
	}

	const keyAssignments = Object.entries(envKeys)
		.map(([key, value]) => {
			const envVar = keyToEnvVar(key);
			return envVar ? `process.env.${envVar} = ${JSON.stringify(String(value))};` : "";
		})
		.filter(Boolean)
		.join("\n");

	const code = `
		import { searchWithExa, hasExaApiKey, isExaAvailable } from ${JSON.stringify(EXA_TS)};

		const mocks = ${mockSeq};
		let callIndex = 0;
		${keyAssignments}

		globalThis.fetch = async (url, opts) => {
			const callNum = callIndex++;
			const mock = mocks[callNum];
			if (!mock) {
				throw new Error("No mock for call #" + callNum + " (url: " + url + ")");
			}
			let label = "unknown";
			if (url.includes("mcp.exa.ai")) label = "mcp";
			else if (url.includes("api.exa.ai")) label = "api";
			console.error("FETCH #" + callNum + " " + label);
			return new Response(mock.body, {
				status: mock.status,
				headers: { "Content-Type": mock.contentType || "application/json" }
			});
		};

		try {
			const result = await searchWithExa(${queryStr}, ${optionsStr});
			console.log("OK:" + JSON.stringify(result));
		} catch (err) {
			console.log("ERR:" + err.message);
		}
	`;

	return spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", code], {
		encoding: "utf8",
		env,
		timeout: 15000,
	});
}

// ─── アサーションヘルパー ────────────────────────────────────────────────

export function assertSearchOk(child, expectedProvider, message) {
	assert.equal(child.status, 0, child.stderr || "Process failed");
	const output = child.stdout.trim();
	assert.ok(output.startsWith("OK:"), `Expected OK but got: ${output}`);
	const result = JSON.parse(output.slice(3));
	if (expectedProvider) {
		assert.equal(result.provider, expectedProvider, message || `Expected provider "${expectedProvider}"`);
	}
	return result;
}

export function assertSearchErr(child, expectedMessage) {
	assert.equal(child.status, 0, child.stderr || "Process failed");
	const output = child.stdout.trim();
	assert.ok(output.startsWith("ERR:"), `Expected ERR but got: ${output}`);
	if (expectedMessage) {
		assert.ok(output.includes(expectedMessage), `Expected "${expectedMessage}" in error: ${output}`);
	}
	return output.slice(4);
}
