# TODO: Exa MCPフォールバック + Tavily統合

## Phase 1: Tavily モジュール（テストファースト） ✅
- [x] `test/tavily.test.mjs` を作成 — 18テスト全PASS
- [x] `tavily.ts` を実装 — `isTavilyAvailable()`, `searchWithTavily()`, `normalizeApiKey()`

## Phase 2: Exa MCP→APIフォールバック（テストファースト） ✅
- [x] `test/exa-fallback.test.mjs` を作成 — 9テスト全PASS
- [x] `exa.ts` — `searchWithExa()`: MCP優先→APIフォールバック、401はthrow、429/402/5xxはnull

## Phase 3: プロバイダチェーン統合
- [ ] `gemini-search.ts` — `SearchProvider` に `"tavily"` 追加、Exa失敗時のフォールバック条件緩和、Tavilyをフォールバックチェーンに挿入
- [ ] `index.ts` — `ProviderAvailability` に `tavily` 追加、`getProviderAvailability()` に `isTavilyAvailable()` 追加、`provider` enum に `"tavily"` 追加、description更新

## Phase 4: 統合テスト
- [ ] `test/provider-chain.test.mjs` を作成 — フォールバック順の検証（fetchモック）

## Phase 5: 動作確認
- [ ] `npm test` 全テスト通過
- [ ] pi にインストールして実動作確認
