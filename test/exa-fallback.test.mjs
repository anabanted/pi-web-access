/**
 * Exa MCP→APIフォールバック テスト
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
	createTestHome,
	writeExaUsage,
	runSearchWithExa,
} from "./helpers.mjs";

describe("searchWithExa: MCP→APIフォールバック", () => {
	test("APIキーなし + MCP成功 → MCP結果を返す", async () => {
		const home = await createTestHome();
		const child = runSearchWithExa(home, [
			{
				status: 200, contentType: "text/event-stream",
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
		const home = await createTestHome();
		const child = runSearchWithExa(home, [
			{ status: 500, contentType: "application/json", body: "MCP server error" },
		]);
		assert.equal(child.status, 0, child.stderr);
		const output = child.stdout.trim();
		assert.ok(output.startsWith("OK:"), `Expected OK but got: ${output}`);
		assert.equal(output.slice(3), "null");
	});

	test("APIキーあり + MCP成功 → APIは呼ばない", async () => {
		const home = await createTestHome("pi-exa-", { exaApiKey: "exa-test-key" });
		await writeExaUsage(home, 0);
		const child = runSearchWithExa(home, [
			{
				status: 200, contentType: "text/event-stream",
				body: `data: {"jsonrpc":"2.0","id":1,"result":{"content":[{"type":"text","text":"Title: MCP Result\\nURL: https://mcp-result.com\\nText: from mcp\\n"}]}}\n`,
			},
		], "test query", { exaApiKey: "exa-test-key" });
		assert.equal(child.status, 0, child.stderr);
		const output = child.stdout.trim();
		assert.ok(output.startsWith("OK:"), `Expected OK but got: ${output}`);
		const result = JSON.parse(output.slice(3));
		assert.ok(result.answer?.includes("MCP Result"));
		assert.ok(child.stderr.includes("FETCH #0 mcp"));
		assert.ok(!child.stderr.includes("FETCH #1"), "API should not be called");
	});

	test("APIキーあり + MCP失敗 → APIにフォールバックして成功", async () => {
		const home = await createTestHome("pi-exa-", { exaApiKey: "exa-test-key" });
		await writeExaUsage(home, 0);
		const child = runSearchWithExa(home, [
			{ status: 429, contentType: "application/json", body: "MCP rate limited" },
			{
				status: 200, contentType: "application/json",
				body: JSON.stringify({
					answer: "API answer",
					citations: [{ title: "API Source", url: "https://api-source.com" }],
				}),
			},
		], "test query", { exaApiKey: "exa-test-key" });
		assert.equal(child.status, 0, child.stderr);
		const output = child.stdout.trim();
		assert.ok(output.startsWith("OK:"), `Expected OK but got: ${output}`);
		const result = JSON.parse(output.slice(3));
		assert.equal(result.answer, "API answer");
		assert.equal(result.results[0].url, "https://api-source.com");
	});

	test("APIキーあり + MCP失敗 + API 429 → null（次プロバイダへ委譲）", async () => {
		const home = await createTestHome("pi-exa-", { exaApiKey: "exa-test-key" });
		await writeExaUsage(home, 0);
		const child = runSearchWithExa(home, [
			{ status: 500, contentType: "application/json", body: "MCP error" },
			{ status: 429, contentType: "application/json", body: JSON.stringify({ detail: "Rate limit" }) },
		], "test query", { exaApiKey: "exa-test-key" });
		assert.equal(child.status, 0, child.stderr);
		const output = child.stdout.trim();
		assert.ok(output.startsWith("OK:"), `Expected OK but got: ${output}`);
		assert.equal(output.slice(3), "null");
	});

	test("APIキーあり + MCP失敗 + API 500 → null", async () => {
		const home = await createTestHome("pi-exa-", { exaApiKey: "exa-test-key" });
		await writeExaUsage(home, 0);
		const child = runSearchWithExa(home, [
			{ status: 500, contentType: "application/json", body: "MCP error" },
			{ status: 500, contentType: "application/json", body: JSON.stringify({ error: "Server error" }) },
		], "test query", { exaApiKey: "exa-test-key" });
		assert.equal(child.status, 0, child.stderr);
		const output = child.stdout.trim();
		assert.ok(output.startsWith("OK:"), `Expected OK but got: ${output}`);
		assert.equal(output.slice(3), "null");
	});

	test("APIキーあり + MCP失敗 + API 401 → 例外throw", async () => {
		const home = await createTestHome("pi-exa-", { exaApiKey: "exa-wrong-key" });
		await writeExaUsage(home, 0);
		const child = runSearchWithExa(home, [
			{ status: 500, contentType: "application/json", body: "MCP error" },
			{ status: 401, contentType: "application/json", body: JSON.stringify({ error: "Invalid API key" }) },
		], "test query", { exaApiKey: "exa-wrong-key" });
		assert.equal(child.status, 0, child.stderr);
		const output = child.stdout.trim();
		assert.ok(output.startsWith("ERR:"), `Expected ERR but got: ${output}`);
		assert.ok(output.includes("401"), `Expected 401 in error: ${output}`);
	});

	test("APIキーあり + MCP失敗 + API 402(quota) → null", async () => {
		const home = await createTestHome("pi-exa-", { exaApiKey: "exa-test-key" });
		await writeExaUsage(home, 0);
		const child = runSearchWithExa(home, [
			{ status: 500, contentType: "application/json", body: "MCP error" },
			{ status: 402, contentType: "application/json", body: JSON.stringify({ error: "Quota exceeded" }) },
		], "test query", { exaApiKey: "exa-test-key" });
		assert.equal(child.status, 0, child.stderr);
		const output = child.stdout.trim();
		assert.ok(output.startsWith("OK:"), `Expected OK but got: ${output}`);
		assert.equal(output.slice(3), "null");
	});

	test("月制限超過 → MCPは試す（API budgetチェックはAPI呼び出し時のみ）", async () => {
		const home = await createTestHome("pi-exa-", { exaApiKey: "exa-test-key" });
		await writeExaUsage(home, 1000);
		const child = runSearchWithExa(home, [
			{
				status: 200, contentType: "text/event-stream",
				body: `data: {"jsonrpc":"2.0","id":1,"result":{"content":[{"type":"text","text":"Title: MCP Result\\nURL: https://example.com\\nText: ok\\n"}]}}\n`,
			},
		], "test query", { exaApiKey: "exa-test-key" });
		assert.equal(child.status, 0, child.stderr);
		const output = child.stdout.trim();
		assert.ok(output.startsWith("OK:"), `Expected OK but got: ${output}`);
		const result = JSON.parse(output.slice(3));
		assert.ok(result.answer?.length > 0);
	});
});
