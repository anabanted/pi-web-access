import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, describe } from "node:test";

const GEMINI_SEARCH_TS = new URL("../gemini-search.ts", import.meta.url).pathname;

/**
 * search() 関数をフェッチモック付きで実行 (auto provider)
 */
function runSearch(home, mocks, envKeys = {}, query = "test") {
	const env = { ...process.env, HOME: home, USERPROFILE: home };
	const mockSeq = JSON.stringify(mocks);
	const keysStr = JSON.stringify(envKeys);
	const queryStr = JSON.stringify(query);
	const code = `
		import { search } from ${JSON.stringify(GEMINI_SEARCH_TS)};

		const mocks = ${mockSeq};
		let callIndex = 0;
		const keys = ${keysStr};
		if (keys.tavilyApiKey) process.env.TAVILY_API_KEY = keys.tavilyApiKey;
		if (keys.perplexityApiKey) process.env.PERPLEXITY_API_KEY = keys.perplexityApiKey;
		if (keys.exaApiKey) process.env.EXA_API_KEY = keys.exaApiKey;
		if (keys.geminiApiKey) process.env.GEMINI_API_KEY = keys.geminiApiKey;
		if (keys.braveApiKey) process.env.BRAVE_API_KEY = keys.braveApiKey;

		globalThis.fetch = async (url, opts) => {
			const callNum = callIndex++;
			const mock = mocks.find(m => url.includes(m.url));
			if (!mock) {
				throw new Error("No mock for call #" + callNum + " (url: " + url + ")");
			}
			console.error("FETCH #" + callNum + " " + url);
			return new Response(mock.body, {
				status: mock.status,
				headers: { "Content-Type": mock.contentType || "application/json" }
			});
		};

		try {
			const result = await search(${queryStr}, { provider: "auto" });
			console.log("OK:" + JSON.stringify({ provider: result.provider, answer: result.answer?.slice(0, 50) }));
		} catch (err) {
			console.log("ERR:" + err.message);
		}
	`;
	return spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", code], {
		encoding: "utf8",
		env,
		timeout: 20000,
	});
}

describe("provider chain: Exa → Tavily → Brave → Perplexity → Gemini", () => {
	test("Exa MCP成功 → Exaで返す", async () => {
		const home = await mkdtemp(join(tmpdir(), "pi-chain-"));
		await mkdir(join(home, ".pi"), { recursive: true });
		await writeFile(join(home, ".pi", "web-search.json"), "{}");

		const child = runSearch(home, [
			{ url: "mcp.exa.ai", status: 200, contentType: "text/event-stream",
				body: `data: {"jsonrpc":"2.0","id":1,"result":{"content":[{"type":"text","text":"Title: MCP\\nURL: https://mcp.example.com\\nText: ok\\n"}]}}\n` },
		]);

		assert.equal(child.status, 0, child.stderr);
		const output = child.stdout.trim();
		assert.ok(output.startsWith("OK:"), `Expected OK but got: ${output}`);
		const result = JSON.parse(output.slice(3));
		assert.equal(result.provider, "exa");
	});

	test("Exa MCP失敗 + Tavily API成功 → Tavilyで返す", async () => {
		const home = await mkdtemp(join(tmpdir(), "pi-chain-"));
		await mkdir(join(home, ".pi"), { recursive: true });
		await writeFile(join(home, ".pi", "web-search.json"), JSON.stringify({ tavilyApiKey: "tvly-key" }));

		const child = runSearch(home, [
			{ url: "mcp.exa.ai", status: 500, body: "MCP error" },
			{ url: "api.tavily.com", status: 200,
				body: JSON.stringify({ answer: "Tavily answer", results: [] }) },
		], { tavilyApiKey: "tvly-key" });

		assert.equal(child.status, 0, child.stderr);
		const output = child.stdout.trim();
		assert.ok(output.startsWith("OK:"), `Expected OK but got: ${output}`);
		const result = JSON.parse(output.slice(3));
		assert.equal(result.provider, "tavily");
	});

	test("Exa MCP失敗 + Tavily API 429 + Brave成功 → Braveで返す", async () => {
		const home = await mkdtemp(join(tmpdir(), "pi-chain-"));
		await mkdir(join(home, ".pi"), { recursive: true });
		await writeFile(join(home, ".pi", "web-search.json"), JSON.stringify({
			tavilyApiKey: "tvly-key",
			braveApiKey: "BSA-key",
		}));

		const child = runSearch(home, [
			{ url: "mcp.exa.ai", status: 500, body: "MCP error" },
			{ url: "api.tavily.com", status: 429,
				body: JSON.stringify({ detail: "Rate limit" }) },
			{ url: "api.search.brave.com", status: 200,
				body: JSON.stringify({ web: { results: [{ title: "Brave R1", url: "https://brave.example.com", description: "brave desc" }] } }) },
		], { tavilyApiKey: "tvly-key", braveApiKey: "BSA-key" });

		assert.equal(child.status, 0, child.stderr);
		const output = child.stdout.trim();
		assert.ok(output.startsWith("OK:"), `Expected OK but got: ${output}`);
		const result = JSON.parse(output.slice(3));
		assert.equal(result.provider, "brave");
	});

	test("Tavilyのみ有効 → Tavilyで返す", async () => {
		const home = await mkdtemp(join(tmpdir(), "pi-chain-"));
		await mkdir(join(home, ".pi"), { recursive: true });
		await writeFile(join(home, ".pi", "web-search.json"), JSON.stringify({ tavilyApiKey: "tvly-key" }));

		const child = runSearch(home, [
			{ url: "mcp.exa.ai", status: 500, body: "MCP error" },
			{ url: "api.tavily.com", status: 200,
				body: JSON.stringify({ answer: "Tavily only", results: [] }) },
		], { tavilyApiKey: "tvly-key" });

		assert.equal(child.status, 0, child.stderr);
		const output = child.stdout.trim();
		assert.ok(output.startsWith("OK:"), `Expected OK but got: ${output}`);
		const result = JSON.parse(output.slice(3));
		assert.equal(result.provider, "tavily");
	});

	test("Braveのみ有効 → Braveで返す", async () => {
		const home = await mkdtemp(join(tmpdir(), "pi-chain-"));
		await mkdir(join(home, ".pi"), { recursive: true });
		await writeFile(join(home, ".pi", "web-search.json"), JSON.stringify({ braveApiKey: "BSA-key" }));

		const child = runSearch(home, [
			{ url: "mcp.exa.ai", status: 500, body: "MCP error" },
			{ url: "api.search.brave.com", status: 200,
				body: JSON.stringify({ web: { results: [{ title: "Brave only", url: "https://brave.example.com", description: "desc" }] } }) },
		], { braveApiKey: "BSA-key" });

		assert.equal(child.status, 0, child.stderr);
		const output = child.stdout.trim();
		assert.ok(output.startsWith("OK:"), `Expected OK but got: ${output}`);
		const result = JSON.parse(output.slice(3));
		assert.equal(result.provider, "brave");
	});

	test("provider=brave 明示指定 → Braveで返す", async () => {
		const home = await mkdtemp(join(tmpdir(), "pi-chain-"));
		await mkdir(join(home, ".pi"), { recursive: true });
		await writeFile(join(home, ".pi", "web-search.json"), JSON.stringify({
			braveApiKey: "BSA-key",
			tavilyApiKey: "tvly-key",
		}));

		const env = { ...process.env, HOME: home, USERPROFILE: home, BRAVE_API_KEY: "BSA-key", TAVILY_API_KEY: "tvly-key" };
		const code = `
			import { search } from ${JSON.stringify(GEMINI_SEARCH_TS)};
			globalThis.fetch = async (url) => {
				if (url.includes("api.search.brave.com")) {
					return new Response(JSON.stringify({ web: { results: [{ title: "Brave explicit", url: "https://brave.ex" }] } }), { status: 200 });
				}
				throw new Error("Unexpected fetch: " + url);
			};
			const result = await search("test", { provider: "brave" });
			console.log("OK:" + JSON.stringify({ provider: result.provider }));
		`;
		const child = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", code], {
			encoding: "utf8", env, timeout: 20000,
		});

		assert.equal(child.status, 0, child.stderr);
		const output = child.stdout.trim();
		assert.ok(output.startsWith("OK:"), `Expected OK but got: ${output}`);
		const result = JSON.parse(output.slice(3));
		assert.equal(result.provider, "brave");
	});
});
