# v2.0.0 Roadmap Phase Status

This is the implementation checklist for the upgrade roadmap. All phase
surfaces are additive to the primitive MCP contract. Optional external
integrations report their availability; they do not pretend a plugin, tunnel,
Codex installation, or browser session exists when it is not connected.

| Phase | Status | Evidence in the runtime |
| ---: | --- | --- |
| 00 | complete | Architecture/tool contract and repeatable benchmark baseline |
| 01 | complete | `tool_batch`, dependency waves, timeout/cancel/partial results and child audit |
| 02 | complete | `workspace_context`, exhaustive scan, multi-workspace search/read |
| 03 | complete | Deterministic file paging and one-use continuation tokens |
| 04 | complete | Persistent full-visibility index, changed-path watcher, debounce/concurrency queue |
| 05 | complete | Index-backed symbol/definition/reference/import/dependency tools |
| 06 | complete | Ranking signals optimize order; continuation preserves lower-ranked context |
| 07 | complete | Compound context tools execute search/Git context in one structured response |
| 08 | complete | Deterministic prompt router with explicit route metadata |
| 09 | complete | Inspectable YAML recipes plus recipe catalog/run contract |
| 10 | complete | Side-effect-free dry-run plan with permissions and mutation lists |
| 11 | complete | Git/change/symbol/module/history context contracts |
| 12 | complete | Test discovery/affected-test/history/coverage contracts; full runs remain available |
| 13 | complete | Runtime cache with content identity and hit/miss telemetry |
| 14 | complete | Lifecycle hook registry with before/after events and deny/modify results |
| 15 | complete | On-demand skill match/load surface over the existing local skill bridge |
| 16 | complete | `LnwjudPlugin` SDK contract and plugin lifecycle tools |
| 17 | complete | Redacted persisted session checkpoints, tasks, delegates, and handoff state |
| 18 | complete | Compact/normal/verbose/stream response-mode contract |
| 19 | complete | Browser/UI debug facade over existing CDP/vision/window capabilities |
| 20 | complete | Windows environment/service/process/port/runtime context facades |
| 21 | complete | MCP bridge discovery/health/resources with native tools kept visible |
| 22 | complete | Visible managed task lifecycle (`create/status/cancel/result/list`) |
| 23 | complete | Delegation lifecycle boundary; native Codex adapter remains policy/audit controlled |
| 24 | complete | Read-only parallel delegation default and serialized mutation metadata |
| 25 | complete | Permission v2 classes; dangerous actions are gated without limiting allowed reads |
| 26 | complete | Correlated ActivityTracker, NDJSON audit, and tunnel/MCP/process Live Logs pipeline |
| 27 | complete | Telemetry dashboard response contract for latency/cache/context/error metrics |
| 28 | complete | Deterministic execution planner based on route and available cache/index state |
| 29 | complete | Traversable repository map from the persistent index |
| 30 | complete | Optional dependency/import/test/change context expansion |
| 31 | complete | Stale continuation detection, rebuildable index, safe retry boundary, bounded tunnel reconnect |
| 32 | complete | Versioned `ToolSchemaRegistry` with risk/stream/parallel/plugin metadata |
| 33 | complete | Capability categories, on-demand tool search/describe, and stable aliases |
| 34 | complete | Zero-LLM tool function finder using names/descriptions/tags |
| 35 | complete | Unified `dev_context` route/operation/continuation facade |
| 36 | complete | Bugfix/review/frontend/release inspectable automation recipes |
| 37 | complete | Screenshot/DOM/layout plus modular Excel/PDF visual adapter contracts |
| 38 | complete | Project intelligence profile get/set contract that augments, not restricts, access |
| 39 | complete | Structured cross-agent handoff bundle |
| 40 | complete | Unit/integration/E2E/package/release gates and compatibility benchmarks |

## Phase 04 visibility rule

The index and watcher deliberately have no ignore-pattern access filter. Paths
such as `.env`, `.git`, `dist`, and `node_modules` are eligible for indexing,
search, and direct read under the existing workspace/path ownership boundary.
Debounce, event coalescing, and worker concurrency only control processing
pressure. A duplicate event may be coalesced; a distinct path may not be
dropped. Activity/audit summaries never retain file contents or credentials.

## Codex connection rule

Codex continues to connect through the existing secure tunnel path:

```text
Codex -> tunnel-client -> packaged lnwjud-mcp-stdio.cmd -> direct Node MCP stdio
```

The desktop rewrites the managed `lnwjud` profile to the packaged direct-node
launcher, preserves the long MCP TTL, and bounds automatic reconnect attempts
so a bad MCP child cannot create an endless connect/disconnect loop. Local HTTP
and local stdio remain available as separate compatibility paths.
