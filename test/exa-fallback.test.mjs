import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, describe, mock } from "node:test";

const EXA_TS = new URL("../exa.ts", import.meta.url).pathname;

/** 分離プロセスでfetchモック付きでsearchWithExaを実行 */
function runSearchWithExa(home, mocks, query = "test query", options = {}) {
	const env = { ...process.env, HOME: home, USERPROFILE: home };
	const mockSeq = JSON.stringify(mocks);
	const queryStr = JSON.stringify(query);
	const optionsStr = JSON.stringify(options);
	const code = `
		import { searchWithExa, hasExaApiKey, isExaAvailable } from ${JSON.stringify(EXA_TS)};

		const mocks = ${mockSeq};
		let callIndex = 0;
		globalThis.fetch = async (url, opts) => {
			const callNum = callIndex++;
			const mock = mocks[callNum];
			if (!mock) {
				throw new Error("No mock for call #" + callNum + " (url: " + url + ")");
			}
			// URL種別を判定
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

/** MCPのみの結果を確認（APIキーなし） */
function runSearchNoApiKey(home, mocks) {
	return runSearchWithExa(home, mocks);
}

/** APIキーありの場合 */
function runSearchWithApiKey(home, mocks) {
	return runSearchWithExa(home, mocks);
}

// ─── テスト ────────────────────────────────────────────────────────

describe("searchWithExa: MCP→APIフォールバック", () => {
	test("APIキーなし + MCP成功 → MCP結果を返す", async () => {
		const home = await mkdtemp(join(tmpdir(), "pi-exa-"));
		await mkdir(join(home, ".pi"), { recursive: true });
		await writeFile(join(home, ".pi", "web-search.json"), "{}");

		const child = runSearchNoApiKey(home, [
			{
				status: 200,
				contentType: "text/event-stream",
				body: `data: {"jsonrpc":"2.0","id":1,"result":{"content":[{"type":"text","text":"Title: Result 1\\nURL: https://example.com\\nText: content here\\n"}]}}\n`,
			},
		]);

		assert.equal(child.status, 0, child.stderr);
		const output = child.stdout.trim();
		assert.ok(output.startsWith("OK:"), `Expected OK but got: ${output}`);
		const result = JSON.parse(output.slice(3));
		assert.ok(result.answer?.length > 0);
		assert.equal(result.results.length, 1);
		assert.equal(result.results[0].url, "https://example.com");
	});

	test("APIキーなし + MCP失敗 → nullを返す", async () => {
		const home = await mkdtemp(join(tmpdir(), "pi-exa-"));
		await mkdir(join(home, ".pi"), { recursive: true });
		await writeFile(join(home, ".pi", "web-search.json"), "{}");

		const child = runSearchNoApiKey(home, [
			{
				status: 500,
				contentType: "application/json",
				body: "MCP server error",
			},
		]);

		assert.equal(child.status, 0, child.stderr);
		const output = child.stdout.trim();
		assert.ok(output.startsWith("OK:"), `Expected OK but got: ${output}`);
		assert.equal(output.slice(3), "null");
	});

	test("APIキーあり + MCP成功 → APIは呼ばない", async () => {
		const home = await mkdtemp(join(tmpdir(), "pi-exa-"));
		await mkdir(join(home, ".pi"), { recursive: true });
		await writeFile(join(home, ".pi", "web-search.json"), JSON.stringify({
			exaApiKey: "exa-test-key",
		}));
		// exa-usage.jsonもリセット
		await writeFile(join(home, ".pi", "exa-usage.json"), JSON.stringify({
			month: new Date().toISOString().slice(0, 7),
			count: 0,
		}));

		const child = runSearchWithApiKey(home, [
			{
				status: 200,
				contentType: "text/event-stream",
				body: `data: {"jsonrpc":"2.0","id":1,"result":{"content":[{"type":"text","text":"Title: MCP Result\\nURL: https://mcp-result.com\\nText: from mcp\\n"}]}}\n`,
			},
		]);

		assert.equal(child.status, 0, child.stderr);
		const output = child.stdout.trim();
		assert.ok(output.startsWith("OK:"), `Expected OK but got: ${output}`);
		const result = JSON.parse(output.slice(3));
		assert.ok(result.answer?.includes("MCP Result"));
		// stderrにFETCH #0 mcp しか出ていないことを確認（APIは呼ばれていない）
		assert.ok(child.stderr.includes("FETCH #0 mcp"));
		assert.ok(!child.stderr.includes("FETCH #1"));
	});

	test("APIキーあり + MCP失敗 → APIにフォールバックして成功", async () => {
		const home = await mkdtemp(join(tmpdir(), "pi-exa-"));
		await mkdir(join(home, ".pi"), { recursive: true });
		await writeFile(join(home, ".pi", "web-search.json"), JSON.stringify({
			exaApiKey: "exa-test-key",
		}));
		await writeFile(join(home, ".pi", "exa-usage.json"), JSON.stringify({
			month: new Date().toISOString().slice(0, 7),
			count: 0,
		}));

		const child = runSearchWithApiKey(home, [
			// call #0: MCP 失敗
			{
				status: 429,
				contentType: "application/json",
				body: "MCP rate limited",
			},
			// call #1: Exa Answer API 成功
			{
				status: 200,
				contentType: "application/json",
				body: JSON.stringify({
					answer: "API answer",
					citations: [
						{ title: "API Source", url: "https://api-source.com" },
					],
				}),
			},
		]);

		assert.equal(child.status, 0, child.stderr);
		const output = child.stdout.trim();
		assert.ok(output.startsWith("OK:"), `Expected OK but got: ${output}`);
		const result = JSON.parse(output.slice(3));
		assert.equal(result.answer, "API answer");
		assert.equal(result.results[0].url, "https://api-source.com");
	});

	test("APIキーあり + MCP失敗 + API 429 → nullを返す（次のプロバイダへ委譲）", async () => {
		const home = await mkdtemp(join(tmpdir(), "pi-exa-"));
		await mkdir(join(home, ".pi"), { recursive: true });
		await writeFile(join(home, ".pi", "web-search.json"), JSON.stringify({
			exaApiKey: "exa-test-key",
		}));
		await writeFile(join(home, ".pi", "exa-usage.json"), JSON.stringify({
			month: new Date().toISOString().slice(0, 7),
			count: 0,
		}));

		const child = runSearchWithApiKey(home, [
			// call #0: MCP 失敗
			{ status: 500, contentType: "application/json", body: "MCP error" },
			// call #1: Exa API 429
			{ status: 429, contentType: "application/json", body: JSON.stringify({ detail: "Rate limit" }) },
		]);

		assert.equal(child.status, 0, child.stderr);
		const output = child.stdout.trim();
		assert.ok(output.startsWith("OK:"), `Expected OK but got: ${output}`);
		assert.equal(output.slice(3), "null");
	});

	test("APIキーあり + MCP失敗 + API 500 → nullを返す", async () => {
		const home = await mkdtemp(join(tmpdir(), "pi-exa-"));
		await mkdir(join(home, ".pi"), { recursive: true });
		await writeFile(join(home, ".pi", "web-search.json"), JSON.stringify({
			exaApiKey: "exa-test-key",
		}));
		await writeFile(join(home, ".pi", "exa-usage.json"), JSON.stringify({
			month: new Date().toISOString().slice(0, 7),
			count: 0,
		}));

		const child = runSearchWithApiKey(home, [
			{ status: 500, contentType: "application/json", body: "MCP error" },
			{ status: 500, contentType: "application/json", body: JSON.stringify({ error: "Server error" }) },
		]);

		assert.equal(child.status, 0, child.stderr);
		const output = child.stdout.trim();
		assert.ok(output.startsWith("OK:"), `Expected OK but got: ${output}`);
		assert.equal(output.slice(3), "null");
	});

	test("APIキーあり + MCP失敗 + API 401 → 例外をthrow", async () => {
		const home = await mkdtemp(join(tmpdir(), "pi-exa-"));
		await mkdir(join(home, ".pi"), { recursive: true });
		await writeFile(join(home, ".pi", "web-search.json"), JSON.stringify({
			exaApiKey: "exa-wrong-key",
		}));
		await writeFile(join(home, ".pi", "exa-usage.json"), JSON.stringify({
			month: new Date().toISOString().slice(0, 7),
			count: 0,
		}));

		const child = runSearchWithApiKey(home, [
			{ status: 500, contentType: "application/json", body: "MCP error" },
			{ status: 401, contentType: "application/json", body: JSON.stringify({ error: "Invalid API key" }) },
		]);

		assert.equal(child.status, 0, child.stderr);
		const output = child.stdout.trim();
		assert.ok(output.startsWith("ERR:"), `Expected ERR but got: ${output}`);
		assert.ok(output.includes("401"), `Expected 401 in error: ${output}`);
	});

	test("APIキーあり + MCP失敗 + API 402(quota) → nullを返す", async () => {
		const home = await mkdtemp(join(tmpdir(), "pi-exa-"));
		await mkdir(join(home, ".pi"), { recursive: true });
		await writeFile(join(home, ".pi", "web-search.json"), JSON.stringify({
			exaApiKey: "exa-test-key",
		}));
		await writeFile(join(home, ".pi", "exa-usage.json"), JSON.stringify({
			month: new Date().toISOString().slice(0, 7),
			count: 0,
		}));

		const child = runSearchWithApiKey(home, [
			{ status: 500, contentType: "application/json", body: "MCP error" },
			{ status: 402, contentType: "application/json", body: JSON.stringify({ error: "Quota exceeded" }) },
		]);

		assert.equal(child.status, 0, child.stderr);
		const output = child.stdout.trim();
		assert.ok(output.startsWith("OK:"), `Expected OK but got: ${output}`);
		assert.equal(output.slice(3), "null");
	});

	test("月制限超過 → { exhausted: true }", async () => {
		const home = await mkdtemp(join(tmpdir(), "pi-exa-"));
		await mkdir(join(home, ".pi"), { recursive: true });
		await writeFile(join(home, ".pi", "web-search.json"), JSON.stringify({
			exaApiKey: "exa-test-key",
		}));
		// 月制限1000に到達
		await writeFile(join(home, ".pi", "exa-usage.json"), JSON.stringify({
			month: new Date().toISOString().slice(0, 7),
			count: 1000,
		}));

		const child = runSearchWithApiKey(home, [
			// MCP成功 → 制限超過チェックの前にMCPが返るので、APIキーありでもMCPが先に試される
			{
				status: 200,
				contentType: "text/event-stream",
				body: `data: {"jsonrpc":"2.0","id":1,"result":{"content":[{"type":"text","text":"Title: MCP Result\\nURL: https://example.com\\nText: ok\\n"}]}}\n`,
			},
		]);

		assert.equal(child.status, 0, child.stderr);
		const output = child.stdout.trim();
		assert.ok(output.startsWith("OK:"), `Expected OK but got: ${output}`);
		const result = JSON.parse(output.slice(3));
		// MCPが成功しているのでMCP結果が返る
		assert.ok(result.answer?.length > 0);
	});
});
