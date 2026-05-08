import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, describe } from "node:test";

const TAVILY_TS = new URL("../tavily.ts", import.meta.url).href;

/** 分離プロセスで tavily.ts の関数を実行 */
function runTavilyFn(home, fnName, ...args) {
	const env = { ...process.env, HOME: home, USERPROFILE: home };
	const tsPath = new URL("../tavily.ts", import.meta.url).pathname;
	const code = `
		import { ${fnName} } from ${JSON.stringify(tsPath)};
		const result = await ${fnName}(...${JSON.stringify(args)});
		console.log(JSON.stringify(result));
	`;
	return spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", code], {
		encoding: "utf8",
		env,
	});
}

/** 分離プロセスで tavily.ts をimportし、関数にfetchモックを注入して実行 */
function runTavilyWithMock(home, query, options, mockResponse) {
	const env = { ...process.env, HOME: home, USERPROFILE: home };
	const tsPath = new URL("../tavily.ts", import.meta.url).pathname;
	const mockStr = JSON.stringify(mockResponse);
	const queryStr = JSON.stringify(query);
	const optionsStr = JSON.stringify(options);
	const code = `
		import { searchWithTavily } from ${JSON.stringify(tsPath)};
		globalThis.fetch = async () => new Response(${mockStr}.body, {
			status: ${mockStr}.status,
			headers: { "Content-Type": "application/json" }
		});
		try {
			const result = await searchWithTavily(${queryStr}, ${optionsStr});
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

// ─── normalizeApiKey ──────────────────────────────────────────────

describe("normalizeApiKey", () => {
	test("正常な文字列を返す", async () => {
		const home = await mkdtemp(join(tmpdir(), "pi-tavily-"));
		await mkdir(join(home, ".pi"), { recursive: true });
		await writeFile(join(home, ".pi", "web-search.json"), JSON.stringify({ tavilyApiKey: "tvly-abc123" }));

		const child = runTavilyFn(home, "normalizeApiKey", "tvly-test");
		assert.equal(child.status, 0, child.stderr);
		assert.equal(child.stdout.trim(), JSON.stringify("tvly-test"));
	});

	test("空文字・whitespaceはnull", async () => {
		const home = await mkdtemp(join(tmpdir(), "pi-tavily-"));
		await mkdir(join(home, ".pi"), { recursive: true });
		await writeFile(join(home, ".pi", "web-search.json"), "{}");

		let child = runTavilyFn(home, "normalizeApiKey", "");
		assert.equal(child.status, 0, child.stderr);
		assert.equal(child.stdout.trim(), JSON.stringify(null));

		child = runTavilyFn(home, "normalizeApiKey", "  ");
		assert.equal(child.stdout.trim(), JSON.stringify(null));
	});

	test("非文字列はnull", async () => {
		const home = await mkdtemp(join(tmpdir(), "pi-tavily-"));
		await mkdir(join(home, ".pi"), { recursive: true });
		await writeFile(join(home, ".pi", "web-search.json"), "{}");

		for (const val of [null, 123]) {
			const child = runTavilyFn(home, "normalizeApiKey", val);
			assert.equal(child.status, 0, child.stderr);
			assert.equal(child.stdout.trim(), JSON.stringify(null));
		}
	});
});

// ─── isTavilyAvailable ────────────────────────────────────────────

describe("isTavilyAvailable", () => {
	test("APIキーあり → true", async () => {
		const home = await mkdtemp(join(tmpdir(), "pi-tavily-"));
		await mkdir(join(home, ".pi"), { recursive: true });
		await writeFile(join(home, ".pi", "web-search.json"), JSON.stringify({ tavilyApiKey: "tvly-abc123" }));

		const child = runTavilyFn(home, "isTavilyAvailable");
		assert.equal(child.status, 0, child.stderr);
		assert.equal(child.stdout.trim(), "true");
	});

	test("APIキーなし → false", async () => {
		const home = await mkdtemp(join(tmpdir(), "pi-tavily-"));
		await mkdir(join(home, ".pi"), { recursive: true });
		await writeFile(join(home, ".pi", "web-search.json"), "{}");

		const child = runTavilyFn(home, "isTavilyAvailable");
		assert.equal(child.status, 0, child.stderr);
		assert.equal(child.stdout.trim(), "false");
	});

	test("環境変数から取得", async () => {
		const home = await mkdtemp(join(tmpdir(), "pi-tavily-"));
		await mkdir(join(home, ".pi"), { recursive: true });
		await writeFile(join(home, ".pi", "web-search.json"), "{}");

		const env = { ...process.env, HOME: home, USERPROFILE: home, TAVILY_API_KEY: "tvly-env-key" };
		const tsPath = new URL("../tavily.ts", import.meta.url).pathname;
		const code = `import { isTavilyAvailable } from ${JSON.stringify(tsPath)}; console.log(isTavilyAvailable());`;
		const child = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", code], {
			encoding: "utf8", env,
		});
		assert.equal(child.status, 0, child.stderr);
		assert.equal(child.stdout.trim(), "true");
	});
});

// ─── searchWithTavily ─────────────────────────────────────────────

describe("searchWithTavily", () => {
	test("正常系 — answerとresultsを返す", async () => {
		const home = await mkdtemp(join(tmpdir(), "pi-tavily-"));
		await mkdir(join(home, ".pi"), { recursive: true });
		await writeFile(join(home, ".pi", "web-search.json"), JSON.stringify({ tavilyApiKey: "tvly-test" }));

		const child = runTavilyWithMock(home, "test query", {}, {
			body: JSON.stringify({
				answer: "Tavily answer content",
				results: [
					{ title: "Result 1", url: "https://example.com/1", content: "content 1", score: 0.9 },
					{ title: "Result 2", url: "https://example.com/2", content: "content 2", score: 0.8 },
				],
			}),
			status: 200,
		});

		assert.equal(child.status, 0, child.stderr);
		const output = child.stdout.trim();
		assert.ok(output.startsWith("OK:"), `Expected OK but got: ${output}`);
		const result = JSON.parse(output.slice(3));
		assert.equal(result.answer, "Tavily answer content");
		assert.equal(result.results.length, 2);
		assert.equal(result.results[0].title, "Result 1");
		assert.equal(result.results[0].url, "https://example.com/1");
	});

	test("numResultsをmax_resultsに変換", async () => {
		const home = await mkdtemp(join(tmpdir(), "pi-tavily-"));
		await mkdir(join(home, ".pi"), { recursive: true });
		await writeFile(join(home, ".pi", "web-search.json"), JSON.stringify({ tavilyApiKey: "tvly-test" }));

		// fetchをキャプチャしてボディを検証
		const tsPath = new URL("../tavily.ts", import.meta.url).pathname;
		const code = `
			import { searchWithTavily } from ${JSON.stringify(tsPath)};
			let capturedBody;
			globalThis.fetch = async (url, opts) => {
				capturedBody = JSON.parse(opts.body);
				return new Response(JSON.stringify({ answer: "", results: [] }), { status: 200 });
			};
			await searchWithTavily("test", { numResults: 10 });
			console.log("OK:" + JSON.stringify(capturedBody));
		`;
		const env = { ...process.env, HOME: home, USERPROFILE: home };
		const child = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", code], {
			encoding: "utf8", env, timeout: 15000,
		});
		assert.equal(child.status, 0, child.stderr);
		const body = JSON.parse(child.stdout.trim().slice(3));
		assert.equal(body.max_results, 10);
	});

	test("domainFilter positive → include_domains", async () => {
		const home = await mkdtemp(join(tmpdir(), "pi-tavily-"));
		await mkdir(join(home, ".pi"), { recursive: true });
		await writeFile(join(home, ".pi", "web-search.json"), JSON.stringify({ tavilyApiKey: "tvly-test" }));

		const tsPath = new URL("../tavily.ts", import.meta.url).pathname;
		const code = `
			import { searchWithTavily } from ${JSON.stringify(tsPath)};
			let capturedBody;
			globalThis.fetch = async (url, opts) => {
				capturedBody = JSON.parse(opts.body);
				return new Response(JSON.stringify({ answer: "", results: [] }), { status: 200 });
			};
			await searchWithTavily("test", { domainFilter: ["github.com", "npmjs.com"] });
			console.log("OK:" + JSON.stringify(capturedBody));
		`;
		const env = { ...process.env, HOME: home, USERPROFILE: home };
		const child = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", code], {
			encoding: "utf8", env, timeout: 15000,
		});
		assert.equal(child.status, 0, child.stderr);
		const body = JSON.parse(child.stdout.trim().slice(3));
		assert.deepEqual(body.include_domains, ["github.com", "npmjs.com"]);
		assert.equal(body.exclude_domains, undefined);
	});

	test("domainFilter negative → exclude_domains", async () => {
		const home = await mkdtemp(join(tmpdir(), "pi-tavily-"));
		await mkdir(join(home, ".pi"), { recursive: true });
		await writeFile(join(home, ".pi", "web-search.json"), JSON.stringify({ tavilyApiKey: "tvly-test" }));

		const tsPath = new URL("../tavily.ts", import.meta.url).pathname;
		const code = `
			import { searchWithTavily } from ${JSON.stringify(tsPath)};
			let capturedBody;
			globalThis.fetch = async (url, opts) => {
				capturedBody = JSON.parse(opts.body);
				return new Response(JSON.stringify({ answer: "", results: [] }), { status: 200 });
			};
			await searchWithTavily("test", { domainFilter: ["-spam.com", "-ads.example.com"] });
			console.log("OK:" + JSON.stringify(capturedBody));
		`;
		const env = { ...process.env, HOME: home, USERPROFILE: home };
		const child = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", code], {
			encoding: "utf8", env, timeout: 15000,
		});
		assert.equal(child.status, 0, child.stderr);
		const body = JSON.parse(child.stdout.trim().slice(3));
		assert.deepEqual(body.exclude_domains, ["spam.com", "ads.example.com"]);
		assert.equal(body.include_domains, undefined);
	});

	test("domainFilter 混在 → include/exclude両方", async () => {
		const home = await mkdtemp(join(tmpdir(), "pi-tavily-"));
		await mkdir(join(home, ".pi"), { recursive: true });
		await writeFile(join(home, ".pi", "web-search.json"), JSON.stringify({ tavilyApiKey: "tvly-test" }));

		const tsPath = new URL("../tavily.ts", import.meta.url).pathname;
		const code = `
			import { searchWithTavily } from ${JSON.stringify(tsPath)};
			let capturedBody;
			globalThis.fetch = async (url, opts) => {
				capturedBody = JSON.parse(opts.body);
				return new Response(JSON.stringify({ answer: "", results: [] }), { status: 200 });
			};
			await searchWithTavily("test", { domainFilter: ["github.com", "-spam.com"] });
			console.log("OK:" + JSON.stringify(capturedBody));
		`;
		const env = { ...process.env, HOME: home, USERPROFILE: home };
		const child = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", code], {
			encoding: "utf8", env, timeout: 15000,
		});
		assert.equal(child.status, 0, child.stderr);
		const body = JSON.parse(child.stdout.trim().slice(3));
		assert.deepEqual(body.include_domains, ["github.com"]);
		assert.deepEqual(body.exclude_domains, ["spam.com"]);
	});

	test("recencyFilter → daysパラメータ", async () => {
		const home = await mkdtemp(join(tmpdir(), "pi-tavily-"));
		await mkdir(join(home, ".pi"), { recursive: true });
		await writeFile(join(home, ".pi", "web-search.json"), JSON.stringify({ tavilyApiKey: "tvly-test" }));

		const tsPath = new URL("../tavily.ts", import.meta.url).pathname;
		const code = `
			import { searchWithTavily } from ${JSON.stringify(tsPath)};
			let capturedBody;
			globalThis.fetch = async (url, opts) => {
				capturedBody = JSON.parse(opts.body);
				return new Response(JSON.stringify({ answer: "", results: [] }), { status: 200 });
			};
			await searchWithTavily("test", { recencyFilter: "week" });
			console.log("OK:" + JSON.stringify(capturedBody));
		`;
		const env = { ...process.env, HOME: home, USERPROFILE: home };
		const child = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", code], {
			encoding: "utf8", env, timeout: 15000,
		});
		assert.equal(child.status, 0, child.stderr);
		const body = JSON.parse(child.stdout.trim().slice(3));
		assert.equal(body.days, 7);
	});

	test("recencyFilter day → 1", async () => {
		const home = await mkdtemp(join(tmpdir(), "pi-tavily-"));
		await mkdir(join(home, ".pi"), { recursive: true });
		await writeFile(join(home, ".pi", "web-search.json"), JSON.stringify({ tavilyApiKey: "tvly-test" }));

		const tsPath = new URL("../tavily.ts", import.meta.url).pathname;
		const code = `
			import { searchWithTavily } from ${JSON.stringify(tsPath)};
			let capturedBody;
			globalThis.fetch = async (url, opts) => {
				capturedBody = JSON.parse(opts.body);
				return new Response(JSON.stringify({ answer: "", results: [] }), { status: 200 });
			};
			await searchWithTavily("test", { recencyFilter: "day" });
			console.log("OK:" + JSON.stringify(capturedBody));
		`;
		const env = { ...process.env, HOME: home, USERPROFILE: home };
		const child = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", code], {
			encoding: "utf8", env, timeout: 15000,
		});
		assert.equal(child.status, 0, child.stderr);
		const body = JSON.parse(child.stdout.trim().slice(3));
		assert.equal(body.days, 1);
	});

	test("APIエラー 401 → 例外", async () => {
		const home = await mkdtemp(join(tmpdir(), "pi-tavily-"));
		await mkdir(join(home, ".pi"), { recursive: true });
		await writeFile(join(home, ".pi", "web-search.json"), JSON.stringify({ tavilyApiKey: "tvly-test" }));

		const child = runTavilyWithMock(home, "test", {}, {
			body: JSON.stringify({ detail: "Invalid API key" }),
			status: 401,
		});

		assert.equal(child.status, 0, child.stderr);
		const output = child.stdout.trim();
		assert.ok(output.startsWith("ERR:"), `Expected ERR but got: ${output}`);
		assert.ok(output.includes("401"), `Expected 401 in error: ${output}`);
	});

	test("APIエラー 429 → 例外", async () => {
		const home = await mkdtemp(join(tmpdir(), "pi-tavily-"));
		await mkdir(join(home, ".pi"), { recursive: true });
		await writeFile(join(home, ".pi", "web-search.json"), JSON.stringify({ tavilyApiKey: "tvly-test" }));

		const child = runTavilyWithMock(home, "test", {}, {
			body: JSON.stringify({ detail: "Rate limit exceeded" }),
			status: 429,
		});

		assert.equal(child.status, 0, child.stderr);
		const output = child.stdout.trim();
		assert.ok(output.startsWith("ERR:"), `Expected ERR but got: ${output}`);
		assert.ok(output.includes("429"), `Expected 429 in error: ${output}`);
	});

	test("APIキーなし → 例外", async () => {
		const home = await mkdtemp(join(tmpdir(), "pi-tavily-"));
		await mkdir(join(home, ".pi"), { recursive: true });
		await writeFile(join(home, ".pi", "web-search.json"), "{}");

		const tsPath = new URL("../tavily.ts", import.meta.url).pathname;
		const code = `
			import { searchWithTavily } from ${JSON.stringify(tsPath)};
			try {
				await searchWithTavily("test");
				console.log("OK:no error");
			} catch (err) {
				console.log("ERR:" + err.message);
			}
		`;
		const env = { ...process.env, HOME: home, USERPROFILE: home };
		const child = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", code], {
			encoding: "utf8", env, timeout: 15000,
		});
		assert.equal(child.status, 0, child.stderr);
		const output = child.stdout.trim();
		assert.ok(output.startsWith("ERR:"), `Expected ERR but got: ${output}`);
		assert.ok(/API key/i.test(output), `Expected API key error: ${output}`);
	});

	test("URLとエンドポイントの検証", async () => {
		const home = await mkdtemp(join(tmpdir(), "pi-tavily-"));
		await mkdir(join(home, ".pi"), { recursive: true });
		await writeFile(join(home, ".pi", "web-search.json"), JSON.stringify({ tavilyApiKey: "tvly-test" }));

		const tsPath = new URL("../tavily.ts", import.meta.url).pathname;
		const code = `
			import { searchWithTavily } from ${JSON.stringify(tsPath)};
			let capturedUrl, capturedMethod;
			globalThis.fetch = async (url, opts) => {
				capturedUrl = url;
				capturedMethod = opts.method;
				return new Response(JSON.stringify({ answer: "", results: [] }), { status: 200 });
			};
			await searchWithTavily("test");
			console.log("OK:" + JSON.stringify({ url: capturedUrl, method: capturedMethod }));
		`;
		const env = { ...process.env, HOME: home, USERPROFILE: home };
		const child = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", code], {
			encoding: "utf8", env, timeout: 15000,
		});
		assert.equal(child.status, 0, child.stderr);
		const info = JSON.parse(child.stdout.trim().slice(3));
		assert.equal(info.url, "https://api.tavily.com/search");
		assert.equal(info.method, "POST");
	});

	test("resultsのsnippetにcontentをマッピング", async () => {
		const home = await mkdtemp(join(tmpdir(), "pi-tavily-"));
		await mkdir(join(home, ".pi"), { recursive: true });
		await writeFile(join(home, ".pi", "web-search.json"), JSON.stringify({ tavilyApiKey: "tvly-test" }));

		const child = runTavilyWithMock(home, "test", {}, {
			body: JSON.stringify({
				answer: "test",
				results: [
					{ title: "R1", url: "https://example.com", content: "This is the content", score: 0.9 },
				],
			}),
			status: 200,
		});

		assert.equal(child.status, 0, child.stderr);
		const output = child.stdout.trim();
		assert.ok(output.startsWith("OK:"), `Expected OK but got: ${output}`);
		const result = JSON.parse(output.slice(3));
		assert.equal(result.results[0].snippet, "This is the content");
	});
});
