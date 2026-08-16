# lnwjud Upgrade Architecture Contract

Status: Phase 05 implementation checkpoint for the `v2.0.0` release candidate.

This document is the architectural boundary for the upgrade roadmap. It describes
the existing runtime before Phase 01 and the invariants every later phase must
preserve. The upgrade adds speed, context delivery, automation, and observability;
it does not remove capabilities or turn ranking into authorization.

The phase-by-phase implementation checklist is
[`ROADMAP_PHASE_STATUS.md`](./ROADMAP_PHASE_STATUS.md).

## Non-negotiable invariants

1. **Unlimited capability, bounded transport.** Large results may be paged,
   streamed, or continued, but the underlying workspace capability must remain
   available. No new feature may silently discard files, matches, symbols, Git
   state, logs, or child-tool results.
2. **Primitive tools remain callable.** Compound tools, routers, recipes, and
   facades reduce round trips; they never replace `read_file`, search, Git,
   process, shell, browser, Windows, logs, tests, or workspace primitives.
3. **Authorization is independent from ranking.** Context ordering is an
   optimization. Path guards, command policy, permission profiles, ownership,
   and hard blocks remain authoritative.
4. **Deterministic work stays local.** Search, file enumeration, Git parsing,
   symbol extraction, cache lookup, routing, policy checks, and test discovery
   must not require an LLM call.
5. **Every operation is traceable.** MCP calls, compound children, recipes,
   hooks, delegated agents, cache decisions, and failures must remain visible in
   structured activity/audit data and the Live Logs pipeline.
6. **Destructive work is never automatically repeated.** Retries may apply to
   safe reads and transport failures only. Writes, deletes, Git destructive
   commands, input events, and external side effects require explicit policy.

## Runtime topology

```text
MCP clients (ChatGPT / Codex / Claude / other agents)
                         |
                         v
             MCP stdio or loopback Streamable HTTP
                         |
                         v
                  ToolRegistry (183 tools after Phase 05–40 foundation)
                         |
       +-----------------+------------------+
       |                 |                  |
       v                 v                  v
  Raw tools       Future execution      Extensions / bridge
                 and context engines   skills + child MCP
       |                 |                  |
       +-----------------+------------------+
                         v
              application services + policy
                         |
       +-----------------+------------------+
       |                 |                  |
       v                 v                  v
  filesystem/search     Git/process/Codex  Windows/browser/media/Office
                         |
                         v
                  storage + audit/activity
                         |
                         v
              Electron IPC -> Live Logs/UI
```

### Package boundaries

| Layer | Current responsibility | Upgrade extension point |
| --- | --- | --- |
| `packages/domain` | IDs, errors, result contracts, policy-neutral types | context/page/task IDs |
| `packages/application` | workspace, file, search, Git, process, project, Codex, doctor use cases | parallel/context/index/recipe services |
| `packages/workspace` | workspace registration, root/path guards, secret policy | index ownership and invalidation |
| `packages/filesystem` | bounded text/binary reads, writes, checkpoints, patching | resumable reads and read-many primitives |
| `packages/search` | executable resolution and direct ripgrep search | indexed search and continuation |
| `packages/git` | argument-array Git adapter and structured parsers | change intelligence and diff context |
| `packages/process` | owned process trees, output buffers, cancellation | batch workers and task runtime |
| `packages/codex` | executable/capability discovery and owned Codex tasks | delegation/session handoff |
| `packages/permissions` | safe/balanced/full/custom profiles and hard blocks | Permission System v2 policy graph |
| `packages/audit` | redaction and structured audit events | child-call, cache, hook and planner events |
| `packages/storage` | SQLite database, migrations, repositories | index/cache/session/telemetry stores |
| `packages/mcp-server` | tool definitions, registry, stdio/HTTP transports | batch/context/router/recipe registration |
| `packages/capabilities` | shell, CDP, Windows UI, input, vision, media, Office, scheduler | Windows/browser intelligence |
| `packages/extensions` | skills and local MCP bridge discovery/calls | plugin SDK, schema registry, aliases |
| `packages/ipc-contracts` | typed Electron main/preload/renderer contracts | dashboard and Live Logs v2 contracts |
| `apps/cli` | CLI runtime and packaged stdio launcher | benchmark and automation entrypoints |
| `apps/desktop` | Electron lifecycle, local HTTP, tunnel, IPC, renderer | observability, planner and session UI |

`domain` and `application` must not import Electron, React, SQLite
implementations, or MCP transport classes. Transport adapters call application
services; they never bypass path, command, permission, ownership, or audit
boundaries.

## Request and side-effect pipeline

```text
MCP/IPC input
  -> Zod/schema validation
  -> normalized workspace/path/command resolution
  -> workspace and ownership checks
  -> permission profile + hard-block decision
  -> application service
  -> guarded adapter (shell:false / argument arrays where applicable)
  -> sanitized result + bounded transport metadata
  -> activity tracker + audit sink
  -> renderer/Live Logs event
```

Read operations may be bounded at the transport boundary only when the result
contains explicit truncation/continuation metadata. Future phases must add
continuation rather than lowering an existing limit silently.

## MCP transports and lifecycle

### stdio

- MCP protocol is the only stdout payload; diagnostics go to stderr.
- The packaged Windows tunnel command is the direct-node
  `lnwjud-mcp-stdio.cmd` launcher. The GUI Electron executable is not used as a
  tunnel child because its stdio handles can close when started by
  `tunnel-client`.
- Closing the peer is a normal shutdown; owned runtime resources are closed once.

### loopback Streamable HTTP

- Endpoint is `/mcp`.
- Default bind is `127.0.0.1`; an ephemeral port is used when the preferred
  port is unavailable.
- Host and Origin policy rejects non-local origins; body size, method, and
  header validation remain enabled.
- The HTTP server and stdio server share the same `ToolRegistry` and
  application services.

### Secure MCP Tunnel

The desktop owns the `tunnel-client` child it starts, rewrites the profile to the
packaged stdio launcher, records the persistent tunnel log, and distinguishes an
owned process from an externally started client. Unexpected exits are surfaced
as errors and reconnect state; the MCP child must remain alive before a tunnel
connection is considered healthy.

## Security and permission boundary

- Workspace paths are normalized and checked against registered roots and
  reparse/junction traversal rules.
- Secret-file policy is denied by default for sensitive filenames and paths.
- Permission profiles are `safe`, `balanced`, `full`, and `custom`; the desktop
  and packaged stdio runtimes intentionally run with the configured full local
  capability profile so the upgrade does not reduce the existing working
  product. A caller still cannot bypass hard blocks or path/ownership checks.
- `READ` is non-mutating, `WRITE` changes workspace data, `EXECUTE` starts or
  controls processes/commands, and `DANGEROUS` covers destructive, interactive,
  external, or full-access meta operations.
- Disk format, shutdown, unowned process termination, workspace-root deletion,
  and other hard-blocked actions remain denied regardless of profile.
- Child MCP servers reached through `mcp_call` retain their own side-effect
  contract; the bridge does not flatten or silently reclassify them.

## Audit, activity, and Live Logs

`ActivityTracker` assigns a call ID and records start/completion, tool name,
result code, duration, workspace/target summary, and sanitized error metadata.
The file sink writes NDJSON to the application data directory; the audit sink
stores redacted structured events in SQLite. A sink failure must not break the
tool call.

`LogHub` merges three sources:

1. `tunnel`: persistent `lnwjud-tunnel.log` tail;
2. `mcp`: activity NDJSON plus synchronized work-log entries;
3. `process`: owned-process summaries and output metadata.

The desktop main process emits snapshots and incremental IPC events. The
renderer keeps live lines that arrive while a snapshot is in flight, deduplicates
by line ID, and supports source tabs, clear, export, and a pop-out viewer. File
tailing retains partial UTF-8 lines across read chunks so Live Logs never turns
one large JSON log entry into unrelated fragments.

## Phase 00 baseline checkpoint

The automated synthetic benchmark runs seven representative workflows over the
real built MCP HTTP runtime and a disposable Git workspace. The v1.1.4 baseline
recorded:

| Metric | Baseline |
| --- | ---: |
| Tool catalog | 53 tools |
| Runs | 3 per scenario |
| Tool calls | 57 |
| Protocol requests | 60 |
| Average tool latency | 97.38 ms |
| p50 tool latency | 60.93 ms |
| p95 tool latency | 761 ms |
| Average workflow latency | 264.39 ms |
| p50 workflow latency | 177.25 ms |
| p95 workflow latency | 808.65 ms |
| Bytes transferred | 98,340 |
| Result bytes | 53,177 |
| Errors / retries | 0 / 0 |

Full per-scenario measurements and the discovered catalog are in
[`../benchmarks/BASELINE.md`](../benchmarks/BASELINE.md). The runner is
[`../../scripts/benchmark-mcp.mjs`](../../scripts/benchmark-mcp.mjs) and must
remain repeatable after every performance phase.

## Phase 01 safety checkpoint

`tool_batch` is additive and routes every child through `ToolRegistry.invoke`.
That preserves schema validation, application policy, activity/audit start and
completion events, and Live Logs visibility for the parent and every child.
Independent read-only children may run concurrently. A child that is not
strictly `READ` plus read-only and non-destructive is treated as mutation work
and is serialized inside a batch, so one compound request cannot fan out
multiple side effects accidentally. A failed, timed-out, or cancelled child is
reported in the combined result without discarding successful siblings.

## Phase 02 context checkpoint

The local context engine adds `workspace_context` and continuation plus
`workspace_full_scan`, `workspace_snapshot`, `search_all`, and
`read_many_files`. It searches registered workspaces in parallel, ranks without
an LLM, reads selected candidates in parallel, and reports the files scanned,
matches, symbols, Git/test relevance, and remaining context. Page and response
targets shape transport size only; they do not hide a path from direct search or
read. Hidden, ignored, generated, dependency, and environment paths remain
eligible candidates.

## Phase 03 streaming checkpoint

`read_file_page` and `read_file_page_continue` provide deterministic line chunks
with explicit `startLine`, `endLine`, `hasMore`, and continuation tokens. The
original `read_file` remains the lossless primitive; paged reads are an additive
transport adapter for large responses. A page can target a response byte size,
and the continuation state advances from the exact returned line so a caller can
resume without silently skipping or overwriting context.

## Phase 04 indexing checkpoint

`WorkspaceIndexService` persists a full structural index outside the repository
data tree and records files, directories, symlinks, hashes, Git blob hashes,
language, tests, package metadata, symbols, imports, exports, functions,
classes, and interfaces. Initial indexing traverses every discoverable path;
there is no `.git`, `node_modules`, `dist`, `.env`, generated-file, or hidden-file
ignore list. The watcher only coalesces duplicate notifications for the same
path and limits active workers. Distinct paths are retained and queued, and a
watcher stop drains the queue before closing.

## Phase 05–14 foundation checkpoint

The deterministic upgrade catalog now exposes code-intelligence queries,
compound context routes, intent routing, inspectable recipes, dry-run plans,
Git/test context contracts, cache operations, lifecycle-hook descriptors, and
the Permission v2 policy classes. These tools are additive: the raw tools and
the full-visibility index remain callable, and the context facade reports its
internal plan plus continuation/fallback paths.

The roadmap catalog is intentionally discoverable on demand through
`capabilities`, `tool_search`, `tool_describe`, and `tool_categories`; this
reduces schema pressure on clients without removing any capability from the
runtime catalog.

## Upgrade sequencing

The safe dependency direction is:

```text
Phase 00 contract
  -> Phase 01 parallel primitives
  -> Phase 02 context aggregation
  -> Phase 03 continuation/streaming
  -> Phase 04 full-visibility index/watcher
  -> Phase 05 code intelligence
  -> Phase 06 lossless ranking
  -> Phase 13 cache
  -> compound/router/recipe/dry-run/Git/test intelligence
  -> hooks/skills/plugins/schema/capability discovery
  -> browser/Windows/visual validation
  -> session/gateway/task/agent/multi-agent/handoff
  -> response/permission/audit/telemetry/planner/resilience/benchmark hardening
```

Each phase adds tests and preserves the baseline primitive catalog. A later
phase may improve latency or context delivery, but it may not make a previously
working capability unavailable merely because a new compound path exists.
