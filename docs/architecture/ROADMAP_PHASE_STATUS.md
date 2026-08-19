# v3.0.0 Roadmap Phase Status

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
| 04 | complete | Persistent index with automatic vendor/build/binary/generated filters, explicit override, changed-path watcher, debounce/concurrency queue |
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
| 41 | complete | Context Economy policy, Context Ledger, duplicate/diff delivery, explicit-access override, and quota telemetry |

## God-Tier Windows AI Gateway waves

These additive waves are tracked separately from the historical Phase 00–41
catalog. “Contract-ready” means the tool has a schema/permission/audit boundary
and reports a truthful optional or planned state when its OS/runtime dependency
is absent; it does not claim that dependency is installed.

| Wave | Status | Evidence |
| ---: | --- | --- |
| 0 | complete | Capability descriptors, health metadata, bounded trace propagation into NDJSON/SQLite audit, and 184-tool compatibility baseline |
| 1 | complete | `wsl_exec` argv-only scoped runner, workspace-owned task handles, cancellation/timeout delegation, and `wsl_fs` translation/metadata boundary |
| 2 | complete | `vision_annotated_capture`, expiring observation hash, screen-origin normalization, annotated PNG, Accessibility revalidation, and gated `ui_target_action` |
| 3 | complete-boundary | `vision.ocr` remains public; WinRT helper adapter, C# source, and sparse-package manifest template are present; signed package registration is environment/release work |
| 4 | complete | Deterministic semantic scorer, primitive-visible ranked candidates, reason codes, permission metadata, `tool_dynamic_filter`, and local-rerank fallback |
| 5 | contract-ready | Artifact-only Windows Sandbox plan plus optional ETW/Event Log catalog contracts; actual Sandbox/provider runtime remains environment-gated |
| 6 | contract-ready | LSP/DAP/database catalog contracts and safe Git worktree dry-run/approval boundary; language servers/debug adapters/database drivers remain optional |
| 7 | contract-ready | PowerPoint/Outlook/PDF/DOCX policy contracts with redaction/dry-run requirements; provider installation remains optional |
| 8 | contract-ready | Self-healing plan is read-only and reversible by construction; mutation/swarm execution remains explicitly planned and approval-gated |

## Phase 04 visibility and economy rule

Automatic discovery/indexing skips vendor, build/cache, binary, and generated
content to reduce I/O and context pressure. This is not an access denial:
`.env`, `.git`, `dist`, and `node_modules` remain available through explicit
file reads, explicit search/index overrides, and full scans under the existing
workspace/path ownership boundary. Debounce, event coalescing, and worker
concurrency control processing pressure. A duplicate event may be coalesced;
a distinct permitted explicit request may not be dropped. Activity/audit
summaries and the bounded Context Ledger never persist file contents or
credentials.

## Codex connection rule

Codex continues to connect through the existing secure tunnel path:

```text
Codex -> tunnel-client -> packaged lnwjud-mcp-stdio.cmd -> direct Node MCP stdio
```

The desktop rewrites the managed `lnwjud` profile to the packaged direct-node
launcher, preserves the long MCP TTL, and bounds automatic reconnect attempts
so a bad MCP child cannot create an endless connect/disconnect loop. Local HTTP
and local stdio remain available as separate compatibility paths.
