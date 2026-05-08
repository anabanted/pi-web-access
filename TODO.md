# TODO: Exa MCPフォールバック + Tavily統合

## Phase 1: Tavily モジュール（テストファースト） ✅
- [x] `test/tavily.test.mjs` を作成 — 18テスト全PASS
- [x] `tavily.ts` を実装 — `isTavilyAvailable()`, `searchWithTavily()`, `normalizeApiKey()`

## Phase 2: Exa MCP→APIフォールバック（テストファースト） ✅
- [x] `test/exa-fallback.test.mjs` を作成 — 9テスト全PASS
- [x] `exa.ts` — `searchWithExa()`: MCP優先→APIフォールバック、401はthrow、429/402/5xxはnull

## Phase 3: プロバイダチェーン統合 ✅
- [x] `gemini-search.ts` — `SearchProvider` に `"tavily"` 追加、Exa失敗時のフォールバック条件緩和、Tavilyをフォールバックチェーンに挿入
- [x] `index.ts` — `ProviderAvailability` に `tavily` 追加、`getProviderAvailability()` に `isTavilyAvailable()` 追加、`provider` enum に `"tavily"` 追加、description更新

## Phase 4: 統合テスト ✅
- [x] `test/provider-chain.test.mjs` を作成 — 4テスト全PASS (Exa→Tavily→Perplexityのフォールバック順検証)

## Phase 5: 動作確認
- [ ] `npm test` 全テスト通過
- [ ] pi にインストールして実動作確認

---

## Phase 6: プロバイダ順序変更 Exa(MCP) → Brave → Tavily → Exa(API)（テストファースト）

### 目的
autoフォールバック順を `Exa(MCP) → Brave → Tavily → Exa(API) → Perplexity → Gemini` に変更する。
Exa MCPとExa APIを個別に制御するため、内部フォールバックをプロバイダチェーンレベルに移動する。

### タスク
- [ ] **6-1. テスト追加**: `test/provider-chain.test.mjs` に新フォールバック順のテストケースを追加
  - Exa MCP成功 → Exaで返す
  - Exa MCP失敗 + Brave成功 → Braveで返す
  - Exa MCP失敗 + Brave失敗 + Tavily成功 → Tavilyで返す
  - Exa MCP失敗 + Brave失敗 + Tavily失敗 + Exa API成功 → Exa APIで返す
  - provider=exa 明示指定時は MCP→APIの内部フォールバックを維持
- [ ] **6-2. exa.ts**: `searchWithExaMcp()` と `searchWithExaApi()` を分離公開
  - `searchWithExa()` は後方互換のため残す（MCP→APIフォールバック）
  - `isExaMcpAvailable()` を追加（常にtrue）
  - `isExaApiAvailable()` を追加（APIキーあり + 月制限未満）
- [ ] **6-3. gemini-search.ts**: フォールバックチェーンを書き換え
  - `SearchProvider` に `"exaApi"` 追加
  - autoフォールバック順: Exa MCP → Brave → Tavily → Exa API → Perplexity → Gemini
  - provider=exa時は従来通りMCP→API内部フォールバック
- [ ] **6-4. index.ts**: `ProviderAvailability` に `exaMcp`/`exaApi` 追加、`resolveProvider()` のauto順更新
- [ ] **6-5. `npm test` 全テスト通過**
