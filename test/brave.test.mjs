import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, describe } from "node:test";

const BRAVE_TS = new URL("../brave.ts", import.meta.url).pathname;

function runBraveFn(home, fnName, ...args) {
	const env = { ...process.env, HOME: home, USERPROFILE: home };
	const code = `
		import { ${fnName} } from ${JSON.stringify(BRAVE_TS)};
		const result = await ${fnName}(...${JSON.stringify(args)});
		console.log(JSON.stringify(result));
	`;
	return spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", code], {
		encoding: "utf8", env,
	});
}

function runSearchWithMock(home, query, options, mockResponse) {
	const env = { ...process.env, HOME: home, USERPROFILE: home };
	const mockStr = JSON.stringify(mockResponse);
	const code = `
		import { searchWithBrave } from ${JSON.stringify(BRAVE_TS)};
		globalThis.fetch = async () => new Response(${mockStr}.body, {
			status: ${mockStr}.status,
			headers: { "Content-Type": "application/json" }
		});
		try {
			const result = await searchWithBrave(${JSON.stringify(query)}, ${JSON.stringify(options)});
			console.log("OK:" + JSON.stringify(result));
		} catch (err) {
			console.log("ERR:" + err.message);
		}
	`;
	return spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", code], {
		encoding: "utf8", env, timeout: 15000,
	});
}

describe("normalizeApiKey", () => {
	test("正常な文字列を返す", async () => {
		const home = await mkdtemp(join(tmpdir(), "pi-brave-"));
		await mkdir(join(home, ".pi"), { recursive: true });
		await writeFile(join(home, ".pi", "web-search.json"), JSON.stringify({ braveApiKey: "BSA-test123" }));
		const child = runBraveFn(home, "normalizeApiKey", "BSA-test");
		assert.equal(child.status, 0, child.stderr);
		assert.equal(child.stdout.trim(), JSON.stringify("BSA-test"));
	});

	test("空文字・whitespaceはnull", async () => {
		const home = await mkdtemp(join(tmpdir(), "pi-brave-"));
		await mkdir(join(home, ".pi"), { recursive: true });
		await writeFile(join(home, ".pi", "web-search.json"), "{}");
		const child = runBraveFn(home, "normalizeApiKey", "");
		assert.equal(child.status, 0, child.stderr);
		assert.equal(child.stdout.trim(), JSON.stringify(null));
	});

	test("非文字列はnull", async () => {
		const home = await mkdtemp(join(tmpdir(), "pi-brave-"));
		await mkdir(join(home, ".pi"), { recursive: true });
		await writeFile(join(home, ".pi", "web-search.json"), "{}");
		const child = runBraveFn(home, "normalizeApiKey", 123);
		assert.equal(child.status, 0, child.stderr);
		assert.equal(child.stdout.trim(), JSON.stringify(null));
	});
});

describe("isBraveAvailable", () => {
	test("APIキーあり → true", async () => {
		const home = await mkdtemp(join(tmpdir(), "pi-brave-"));
		await mkdir(join(home, ".pi"), { recursive: true });
		await writeFile(join(home, ".pi", "web-search.json"), JSON.stringify({ braveApiKey: "BSA-test" }));
		const child = runBraveFn(home, "isBraveAvailable");
		assert.equal(child.status, 0, child.stderr);
		assert.equal(child.stdout.trim(), "true");
	});

	test("APIキーなし → false", async () => {
		const home = await mkdtemp(join(tmpdir(), "pi-brave-"));
		await mkdir(join(home, ".pi"), { recursive: true });
		await writeFile(join(home, ".pi", "web-search.json"), "{}");
		const child = runBraveFn(home, "isBraveAvailable");
		assert.equal(child.status, 0, child.stderr);
		assert.equal(child.stdout.trim(), "false");
	});

	test("環境変数から取得", async () => {
		const home = await mkdtemp(join(tmpdir(), "pi-brave-"));
		await mkdir(join(home, ".pi"), { recursive: true });
		await writeFile(join(home, ".pi", "web-search.json"), "{}");
		const env = { ...process.env, HOME: home, USERPROFILE: home, BRAVE_API_KEY: "BSA-env" };
		const code = `import { isBraveAvailable } from ${JSON.stringify(BRAVE_TS)}; console.log(isBraveAvailable());`;
		const child = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", code], {
			encoding: "utf8", env,
		});
		assert.equal(child.status, 0, child.stderr);
		assert.equal(child.stdout.trim(), "true");
	});
});

describe("searchWithBrave", () => {
	test("正常系 — answerとresultsを返す", async () => {
		const home = await mkdtemp(join(tmpdir(), "pi-brave-"));
		await mkdir(join(home, ".pi"), { recursive: true });
		await writeFile(join(home, ".pi", "web-search.json"), JSON.stringify({ braveApiKey: "BSA-test" }));

		const child = runSearchWithMock(home, "test query", {}, {
			body: JSON.stringify({
				web: {
					results: [
						{ title: "Result 1", url: "https://example.com/1", description: "desc 1" },
						{ title: "Result 2", url: "https://example.com/2", description: "desc 2" },
					],
				},
			}),
			status: 200,
		});

		assert.equal(child.status, 0, child.stderr);
		const output = child.stdout.trim();
		assert.ok(output.startsWith("OK:"), `Expected OK but got: ${output}`);
		const result = JSON.parse(output.slice(3));
		assert.ok(result.answer?.length > 0 || result.results.length > 0);
		assert.equal(result.results[0].title, "Result 1");
		assert.equal(result.results[0].url, "https://example.com/1");
	});

	test("numResultsをcountに変換", async () => {
		const home = await mkdtemp(join(tmpdir(), "pi-brave-"));
		await mkdir(join(home, ".pi"), { recursive: true });
		await writeFile(join(home, ".pi", "web-search.json"), JSON.stringify({ braveApiKey: "BSA-test" }));

		const code = `
			import { searchWithBrave } from ${JSON.stringify(BRAVE_TS)};
			let capturedUrl;
			globalThis.fetch = async (url) => {
				capturedUrl = url;
				return new Response(JSON.stringify({ web: { results: [] } }), { status: 200 });
			};
			await searchWithBrave("test", { numResults: 10 });
			console.log("OK:" + capturedUrl);
		`;
		const env = { ...process.env, HOME: home, USERPROFILE: home };
		const child = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", code], {
			encoding: "utf8", env, timeout: 15000,
		});
		assert.equal(child.status, 0, child.stderr);
		const url = child.stdout.trim().slice(3);
		assert.ok(url.includes("count=10"), `Expected count=10 in URL: ${url}`);
	});

	test("domainFilter positive → site:演算子をクエリに追加", async () => {
		const home = await mkdtemp(join(tmpdir(), "pi-brave-"));
		await mkdir(join(home, ".pi"), { recursive: true });
		await writeFile(join(home, ".pi", "web-search.json"), JSON.stringify({ braveApiKey: "BSA-test" }));

		const code = `
			import { searchWithBrave } from ${JSON.stringify(BRAVE_TS)};
			let capturedUrl;
			globalThis.fetch = async (url) => {
				capturedUrl = url;
				return new Response(JSON.stringify({ web: { results: [] } }), { status: 200 });
			};
			await searchWithBrave("test", { domainFilter: ["github.com"] });
			console.log("OK:" + capturedUrl);
		`;
		const env = { ...process.env, HOME: home, USERPROFILE: home };
		const child = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", code], {
			encoding: "utf8", env, timeout: 15000,
		});
		assert.equal(child.status, 0, child.stderr);
		const url = child.stdout.trim().slice(3);
		assert.ok(url.includes("site%3Agithub.com") || url.includes("site:github.com"),
			`Expected site:github.com in URL: ${url}`);
	});

	test("domainFilter negative → -site:演算子をクエリに追加", async () => {
		const home = await mkdtemp(join(tmpdir(), "pi-brave-"));
		await mkdir(join(home, ".pi"), { recursive: true });
		await writeFile(join(home, ".pi", "web-search.json"), JSON.stringify({ braveApiKey: "BSA-test" }));

		const code = `
			import { searchWithBrave } from ${JSON.stringify(BRAVE_TS)};
			let capturedUrl;
			globalThis.fetch = async (url) => {
				capturedUrl = url;
				return new Response(JSON.stringify({ web: { results: [] } }), { status: 200 });
			};
			await searchWithBrave("test", { domainFilter: ["-spam.com"] });
			console.log("OK:" + capturedUrl);
		`;
		const env = { ...process.env, HOME: home, USERPROFILE: home };
		const child = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", code], {
			encoding: "utf8", env, timeout: 15000,
		});
		assert.equal(child.status, 0, child.stderr);
		const url = child.stdout.trim().slice(3);
		assert.ok(url.includes("-site%3Aspam.com") || url.includes("-site:spam.com"),
			`Expected -site:spam.com in URL: ${url}`);
	});

	test("recencyFilter week → freshness=pw", async () => {
		const home = await mkdtemp(join(tmpdir(), "pi-brave-"));
		await mkdir(join(home, ".pi"), { recursive: true });
		await writeFile(join(home, ".pi", "web-search.json"), JSON.stringify({ braveApiKey: "BSA-test" }));

		const code = `
			import { searchWithBrave } from ${JSON.stringify(BRAVE_TS)};
			let capturedUrl;
			globalThis.fetch = async (url) => {
				capturedUrl = url;
				return new Response(JSON.stringify({ web: { results: [] } }), { status: 200 });
			};
			await searchWithBrave("test", { recencyFilter: "week" });
			console.log("OK:" + capturedUrl);
		`;
		const env = { ...process.env, HOME: home, USERPROFILE: home };
		const child = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", code], {
			encoding: "utf8", env, timeout: 15000,
		});
		assert.equal(child.status, 0, child.stderr);
		const url = child.stdout.trim().slice(3);
		assert.ok(url.includes("freshness=pw"), `Expected freshness=pw in URL: ${url}`);
	});

	test("recencyFilter day → pw (past week = 24h)", async () => {
		const home = await mkdtemp(join(tmpdir(), "pi-brave-"));
		await mkdir(join(home, ".pi"), { recursive: true });
		await writeFile(join(home, ".pi", "web-search.json"), JSON.stringify({ braveApiKey: "BSA-test" }));

		const code = `
			import { searchWithBrave } from ${JSON.stringify(BRAVE_TS)};
			let capturedUrl;
			globalThis.fetch = async (url) => {
				capturedUrl = url;
				return new Response(JSON.stringify({ web: { results: [] } }), { status: 200 });
			};
			await searchWithBrave("test", { recencyFilter: "day" });
			console.log("OK:" + capturedUrl);
		`;
		const env = { ...process.env, HOME: home, USERPROFILE: home };
		const child = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", code], {
			encoding: "utf8", env, timeout: 15000,
		});
		assert.equal(child.status, 0, child.stderr);
		const url = child.stdout.trim().slice(3);
		// Braveのfreshness: pd = past day
		assert.ok(url.includes("freshness=pd"), `Expected freshness=pd in URL: ${url}`);
	});

	test("APIエラー 401 → 例外", async () => {
		const home = await mkdtemp(join(tmpdir(), "pi-brave-"));
		await mkdir(join(home, ".pi"), { recursive: true });
		await writeFile(join(home, ".pi", "web-search.json"), JSON.stringify({ braveApiKey: "BSA-test" }));

		const child = runSearchWithMock(home, "test", {}, {
			body: JSON.stringify({ message: "Unauthorized" }),
			status: 401,
		});

		assert.equal(child.status, 0, child.stderr);
		const output = child.stdout.trim();
		assert.ok(output.startsWith("ERR:"), `Expected ERR but got: ${output}`);
		assert.ok(output.includes("401"), `Expected 401 in error: ${output}`);
	});

	test("APIエラー 429 → 例外", async () => {
		const home = await mkdtemp(join(tmpdir(), "pi-brave-"));
		await mkdir(join(home, ".pi"), { recursive: true });
		await writeFile(join(home, ".pi", "web-search.json"), JSON.stringify({ braveApiKey: "BSA-test" }));

		const child = runSearchWithMock(home, "test", {}, {
			body: JSON.stringify({ message: "Rate limit exceeded" }),
			status: 429,
		});

		assert.equal(child.status, 0, child.stderr);
		const output = child.stdout.trim();
		assert.ok(output.startsWith("ERR:"), `Expected ERR but got: ${output}`);
		assert.ok(output.includes("429"), `Expected 429 in error: ${output}`);
	});

	test("APIキーなし → 例外", async () => {
		const home = await mkdtemp(join(tmpdir(), "pi-brave-"));
		await mkdir(join(home, ".pi"), { recursive: true });
		await writeFile(join(home, ".pi", "web-search.json"), "{}");

		const code = `
			import { searchWithBrave } from ${JSON.stringify(BRAVE_TS)};
			try {
				await searchWithBrave("test");
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
		const home = await mkdtemp(join(tmpdir(), "pi-brave-"));
		await mkdir(join(home, ".pi"), { recursive: true });
		await writeFile(join(home, ".pi", "web-search.json"), JSON.stringify({ braveApiKey: "BSA-test" }));

		const code = `
			import { searchWithBrave } from ${JSON.stringify(BRAVE_TS)};
			let capturedUrl, capturedHeaders;
			globalThis.fetch = async (url, opts) => {
				capturedUrl = url;
				capturedHeaders = opts.headers;
				return new Response(JSON.stringify({ web: { results: [] } }), { status: 200 });
			};
			await searchWithBrave("test");
			console.log("OK:" + JSON.stringify({ url: capturedUrl, headers: capturedHeaders }));
		`;
		const env = { ...process.env, HOME: home, USERPROFILE: home };
		const child = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", code], {
			encoding: "utf8", env, timeout: 15000,
		});
		assert.equal(child.status, 0, child.stderr);
		const info = JSON.parse(child.stdout.trim().slice(3));
		assert.ok(info.url.includes("api.search.brave.com"));
		assert.ok(info.url.includes("/res/v1/web/search"));
		assert.equal(info.headers["X-Subscription-Token"], "BSA-test");
	});

	test("resultsのsnippetにdescriptionをマッピング", async () => {
		const home = await mkdtemp(join(tmpdir(), "pi-brave-"));
		await mkdir(join(home, ".pi"), { recursive: true });
		await writeFile(join(home, ".pi", "web-search.json"), JSON.stringify({ braveApiKey: "BSA-test" }));

		const child = runSearchWithMock(home, "test", {}, {
			body: JSON.stringify({
				web: {
					results: [
						{ title: "R1", url: "https://example.com", description: "This is the description" },
					],
				},
			}),
			status: 200,
		});

		assert.equal(child.status, 0, child.stderr);
		const output = child.stdout.trim();
		assert.ok(output.startsWith("OK:"), `Expected OK but got: ${output}`);
		const result = JSON.parse(output.slice(3));
		assert.equal(result.results[0].snippet, "This is the description");
	});
});
