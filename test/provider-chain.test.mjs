/**
 * プロバイダチェーン テスト
 * フォールバック順: Exa(MCP) → Brave → Tavily → Exa(API) → Perplexity → Gemini
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
	createTestHome,
	writeExaUsage,
	runSearch,
	runSearchWithProvider,
	assertSearchOk,
	mcpOk, mcpFail,
	braveOk, braveFail,
	tavilyOk, tavilyFail,
	exaApiOk,
} from "./helpers.mjs";

describe("provider chain (auto): Exa(MCP) → Brave → Tavily → Exa(API)", () => {
	test("Exa MCP成功 → Exaで返す", async () => {
		const home = await createTestHome();
		const child = runSearch(home, [mcpOk("MCP success")]);
		assertSearchOk(child, "exa");
	});

	test("Exa MCP失敗 + Brave成功 → Braveで返す", async () => {
		const home = await createTestHome("pi-chain-", {
			braveApiKey: "BSA-key",
			tavilyApiKey: "tvly-key",
		});
		const child = runSearch(home, [mcpFail(), braveOk("Brave wins")], {
			braveApiKey: "BSA-key", tavilyApiKey: "tvly-key",
		});
		assertSearchOk(child, "brave");
	});

	test("Exa MCP失敗 + Brave失敗 + Tavily成功 → Tavilyで返す", async () => {
		const home = await createTestHome("pi-chain-", {
			braveApiKey: "BSA-key",
			tavilyApiKey: "tvly-key",
		});
		const child = runSearch(home, [mcpFail(), braveFail(), tavilyOk("Tavily wins")], {
			braveApiKey: "BSA-key", tavilyApiKey: "tvly-key",
		});
		assertSearchOk(child, "tavily");
	});

	test("Exa MCP失敗 + Brave失敗 + Tavily失敗 + Exa API成功 → Exa APIで返す", async () => {
		const home = await createTestHome("pi-chain-", {
			exaApiKey: "exa-test-key",
			braveApiKey: "BSA-key",
			tavilyApiKey: "tvly-key",
		});
		await writeExaUsage(home, 0);
		const child = runSearch(home, [
			mcpFail(), braveFail(), tavilyFail(), exaApiOk("Exa API wins"),
		], {
			exaApiKey: "exa-test-key",
			braveApiKey: "BSA-key",
			tavilyApiKey: "tvly-key",
		});
		assertSearchOk(child, "exaApi");
	});

	test("Braveのみ有効 → Braveで返す", async () => {
		const home = await createTestHome("pi-chain-", { braveApiKey: "BSA-key" });
		const child = runSearch(home, [mcpFail(), braveOk("Brave only")], {
			braveApiKey: "BSA-key",
		});
		assertSearchOk(child, "brave");
	});

	test("Tavilyのみ有効 → Tavilyで返す", async () => {
		const home = await createTestHome("pi-chain-", { tavilyApiKey: "tvly-key" });
		const child = runSearch(home, [mcpFail(), tavilyOk("Tavily only")], {
			tavilyApiKey: "tvly-key",
		});
		assertSearchOk(child, "tavily");
	});
});

describe("explicit provider: no cross-fallback", () => {
	test("provider=exa → MCP→API内部フォールバックのみ、Braveにはいかない", async () => {
		const home = await createTestHome("pi-chain-", {
			exaApiKey: "exa-test-key",
			braveApiKey: "BSA-key",
		});
		await writeExaUsage(home, 0);
		const child = runSearchWithProvider(home, "exa", [
			mcpFail(), exaApiOk("Exa explicit"),
		], {
			exaApiKey: "exa-test-key",
			braveApiKey: "BSA-key",
		});
		const result = assertSearchOk(child, "exa");
		// Braveの結果が含まれていないことを確認
		assert.ok(!result.answer?.includes("Brave"), "Should not contain Brave results");
	});

	test("provider=exaApi → 直接Exa APIのみ", async () => {
		const home = await createTestHome("pi-chain-", { exaApiKey: "exa-test-key" });
		await writeExaUsage(home, 0);
		const child = runSearchWithProvider(home, "exaApi", [
			exaApiOk("Exa API explicit"),
		], { exaApiKey: "exa-test-key" });
		assertSearchOk(child, "exaApi");
	});

	test("provider=brave → 直接Braveのみ、Tavilyにはいかない", async () => {
		const home = await createTestHome("pi-chain-", {
			braveApiKey: "BSA-key",
			tavilyApiKey: "tvly-key",
		});
		const child = runSearchWithProvider(home, "brave", [
			braveOk("Brave explicit"),
		], {
			braveApiKey: "BSA-key",
			tavilyApiKey: "tvly-key",
		});
		const result = assertSearchOk(child, "brave");
		assert.ok(!result.answer?.includes("Tavily"), "Should not contain Tavily results");
	});

	test("provider=tavily → 直接Tavilyのみ", async () => {
		const home = await createTestHome("pi-chain-", { tavilyApiKey: "tvly-key" });
		const child = runSearchWithProvider(home, "tavily", [
			tavilyOk("Tavily explicit"),
		], { tavilyApiKey: "tvly-key" });
		assertSearchOk(child, "tavily");
	});

	test("provider=brave でBraveキーなし → エラー（Tavilyにフォールバックしない）", async () => {
		const home = await createTestHome("pi-chain-", {
			tavilyApiKey: "tvly-key",
		});
		const child = runSearchWithProvider(home, "brave", [
			tavilyOk("Should not reach here"),
		], { tavilyApiKey: "tvly-key" });
		assert.equal(child.status, 0, child.stderr);
		const output = child.stdout.trim();
		assert.ok(output.startsWith("ERR:"), `Expected ERR but got: ${output}`);
		assert.ok(output.includes("Brave API key not found"), `Expected key error: ${output}`);
	});
});
