# lnwjud Tool Contract

Status: Phase 05 contract snapshot for `v1.1.4` / local upgrade commits.

This is the compatibility contract for the current MCP surface. The runtime
advertises the JSON Schema for every input through `tools/list`; the TypeScript
Zod schemas in `packages/mcp-server/src/tools/` are the implementation source
of truth. The existing human-oriented catalog remains useful for field details,
while this document records the complete 177-tool runtime snapshot, policy class,
annotations, and schema source.

## Protocol and result rules

- Tool names and registry order are deterministic.
- Every request is schema-validated before the application service runs.
- Every result is structured JSON-compatible MCP content; errors use the
  repository error/result mapping and do not expose secrets or raw stack traces.
- `readOnlyHint` is advisory metadata for clients. It never grants permission.
- `destructiveHint` is advisory metadata for clients. Permission policy and hard
  blocks remain authoritative.
- A bounded result must report truncation, continuation, or a bounded-window
  contract. A new compound tool cannot hide data that a primitive tool can read.
- `workspaceId` is required where the operation is workspace-scoped unless an
  explicitly normalized absolute path is accepted by that tool's schema.

## Permission classes

| Class | Meaning | Existing profile behavior |
| --- | --- | --- |
| `READ` | No intentional mutation; inspection or local diagnostics | allowed by Safe/Balanced/Full |
| `WRITE` | Changes workspace files or registration state | prompts in Safe; allowed in Balanced/Full |
| `EXECUTE` | Starts/controls an owned command, process, project, or Codex task | prompts in Safe; allowed in Balanced/Full |
| `DANGEROUS` | Destructive, interactive, external, or full-access meta capability | denied in Safe; prompts in Balanced; allowed in Full subject to hard blocks |

Desktop and packaged stdio runtimes use the configured full local capability
profile to preserve the working v1 behavior. This does not disable workspace
guards, ownership checks, secret policy, or hard blocks.

## Complete runtime catalog

The `schema` column identifies the authoritative implementation file and the
number of top-level input properties observed from the live `tools/list`
response. The exact optional/default/enum constraints are the Zod schema in that
file and the MCP JSON Schema returned at runtime; changing either requires a
contract test and a catalog update.

| # | Tool | Permission | Read-only hint | Destructive hint | Input properties | Schema source |
| ---: | --- | --- | :---: | :---: | ---: | --- |
| 1 | `workspace_list` | DANGEROUS | no | no | 0 | `workspace-tools.ts` |
| 2 | `workspace_register` | WRITE | no | no | 3 | `workspace-tools.ts` |
| 3 | `workspace_info` | READ | yes | no | 1 | `workspace-tools.ts` |
| 4 | `workspace_tree` | READ | yes | no | 4 | `workspace-tools.ts` |
| 5 | `project_snapshot` | READ | yes | no | 1 | `workspace-tools.ts` |
| 6 | `read_file` | READ | yes | no | 4 | `file-tools.ts` |
| 7 | `read_files` | READ | yes | no | 2 | `file-tools.ts` |
| 8 | `search_files` | READ | yes | no | 4 | `search-tools.ts` |
| 9 | `search_text` | READ | yes | no | 5 | `search-tools.ts` |
| 10 | `git_status` | READ | yes | no | 1 | `git-tools.ts` |
| 11 | `git_diff` | READ | yes | no | 4 | `git-tools.ts` |
| 12 | `git_log` | READ | yes | no | 3 | `git-tools.ts` |
| 13 | `git` | EXECUTE | no | yes | 4 | `git-tools.ts` |
| 14 | `write_file` | WRITE | no | no | 3 | `file-tools.ts` |
| 15 | `apply_patch` | WRITE | no | no | 2 | `file-tools.ts` |
| 16 | `move_file` | WRITE | no | no | 3 | `file-tools.ts` |
| 17 | `copy_file` | WRITE | no | no | 3 | `file-tools.ts` |
| 18 | `delete_file` | DANGEROUS | no | yes | 3 | `file-tools.ts` |
| 19 | `process_start` | EXECUTE | no | no | 5 | `process-tools.ts` |
| 20 | `process_status` | READ | yes | no | 2 | `process-tools.ts` |
| 21 | `process_logs` | READ | yes | no | 4 | `process-tools.ts` |
| 22 | `process_stop` | EXECUTE | no | no | 2 | `process-tools.ts` |
| 23 | `project_dev` | EXECUTE | no | no | 1 | `process-tools.ts` |
| 24 | `project_test` | EXECUTE | no | no | 1 | `process-tools.ts` |
| 25 | `project_lint` | EXECUTE | no | no | 1 | `process-tools.ts` |
| 26 | `project_typecheck` | EXECUTE | no | no | 1 | `process-tools.ts` |
| 27 | `project_build` | EXECUTE | no | no | 1 | `process-tools.ts` |
| 28 | `codex_status` | READ | yes | no | 0 | `codex-tools.ts` |
| 29 | `codex_run` | EXECUTE | no | no | 2 | `codex-tools.ts` |
| 30 | `codex_task_status` | READ | yes | no | 2 | `codex-tools.ts` |
| 31 | `codex_task_logs` | READ | yes | no | 4 | `codex-tools.ts` |
| 32 | `codex_stop` | EXECUTE | no | no | 2 | `codex-tools.ts` |
| 33 | `shell` | EXECUTE | no | yes | 16 | `capability-tools.ts` |
| 34 | `dom_cdp` | DANGEROUS | no | yes | 10 | `capability-tools.ts` |
| 35 | `accessibility` | DANGEROUS | no | yes | 8 | `capability-tools.ts` |
| 36 | `input_event` | DANGEROUS | no | yes | 8 | `capability-tools.ts` |
| 37 | `vision` | READ | yes | no | 12 | `capability-tools.ts` |
| 38 | `window` | DANGEROUS | no | yes | 6 | `capability-tools.ts` |
| 39 | `health` | READ | yes | no | 3 | `capability-tools.ts` |
| 40 | `system_info` | READ | yes | no | 5 | `capability-tools.ts` |
| 41 | `notification` | EXECUTE | no | no | 6 | `capability-tools.ts` |
| 42 | `file_dialog` | EXECUTE | yes | no | 8 | `capability-tools.ts` |
| 43 | `clipboard` | DANGEROUS | no | no | 5 | `capability-tools.ts` |
| 44 | `web_fetch` | DANGEROUS | yes | no | 9 | `capability-tools.ts` |
| 45 | `audio` | DANGEROUS | no | no | 7 | `capability-tools.ts` |
| 46 | `screen_record` | DANGEROUS | no | no | 10 | `capability-tools.ts` |
| 47 | `office` | DANGEROUS | no | no | 12 | `capability-tools.ts` |
| 48 | `scheduler` | DANGEROUS | no | yes | 10 | `capability-tools.ts` |
| 49 | `skills_list` | DANGEROUS | no | yes | 2 | `skill-tools.ts` |
| 50 | `skills_read` | DANGEROUS | no | yes | 2 | `skill-tools.ts` |
| 51 | `mcp_list` | DANGEROUS | no | yes | 0 | `mcp-bridge-tools.ts` |
| 52 | `mcp_describe` | DANGEROUS | no | yes | 1 | `mcp-bridge-tools.ts` |
| 53 | `mcp_call` | DANGEROUS | no | yes | 3 | `mcp-bridge-tools.ts` |
| 54 | `tool_batch` | DANGEROUS | no | yes | 3 | `batch-tools.ts` |
| 55 | `workspace_context` | READ | yes | no | 7 | `context-tools.ts` |
| 56 | `workspace_context_continue` | READ | yes | no | 2 | `context-tools.ts` |
| 57 | `workspace_full_scan` | READ | yes | no | 4 | `context-tools.ts` |
| 58 | `workspace_full_scan_continue` | READ | yes | no | 2 | `context-tools.ts` |
| 59 | `workspace_snapshot` | READ | yes | no | 1 | `context-tools.ts` |
| 60 | `search_all` | READ | yes | no | 5 | `context-tools.ts` |
| 61 | `read_many_files` | READ | yes | no | 2 | `context-tools.ts` |
| 62 | `read_file_page` | READ | yes | no | 5 | `file-page-tools.ts` |
| 63 | `read_file_page_continue` | READ | yes | no | 2 | `file-page-tools.ts` |
| 64 | `workspace_index` | READ | yes | no | 2 | `workspace-index-tools.ts` |
| 65 | `workspace_index_status` | READ | yes | no | 1 | `workspace-index-tools.ts` |
| 66 | `workspace_index_watch` | READ | yes | no | 3 | `workspace-index-tools.ts` |
| 67 | `workspace_index_stop` | READ | yes | no | 1 | `workspace-index-tools.ts` |

## Schema groups and contract examples

The following examples make the required shape explicit without duplicating the
generated JSON Schema. Optional fields and bounds must remain aligned with the
source schema and the runtime `tools/list` response.

### Workspace and filesystem

```ts
workspace_list: {}
workspace_register: {
  parentWorkspaceId: string;
  path: string;
  displayName?: string;
}
workspace_info: { workspaceId: string }
workspace_tree: {
  workspaceId?: string;
  path?: string;
  maxDepth?: number;
  maxEntries?: number;
}
project_snapshot: { workspaceId: string }
read_file: {
  workspaceId?: string;
  path: string;
  startLine?: number;
  endLine?: number;
}
read_files: { workspaceId?: string; files: Array<{ path: string; startLine?: number; endLine?: number }> }
search_files: { workspaceId?: string; path?: string; glob?: string; maxResults?: number }
search_text: {
  workspaceId?: string;
  path?: string;
  query: string;
  glob?: string;
  maxResults?: number;
}
```

`write_file`, `apply_patch`, `move_file`, `copy_file`, and `delete_file` retain
their checkpoint, same-workspace, secret-policy, confirmation, and path-guard
contracts. They must not acquire implicit recursive or arbitrary-root behavior.

### Git, process, project, and Codex

```ts
git_status: { workspaceId: string }
git_diff: { workspaceId: string; path?: string; staged?: boolean; maxBytes?: number }
git_log: { workspaceId: string; maxCommits?: number; maxBytes?: number }
git: { workspaceId?: string; cwd?: string; args: string[]; timeoutSeconds?: number }
process_start: { workspaceId: string; executable: string; args: string[]; cwd?: string; timeoutMs?: number }
process_status: { workspaceId: string; processId: string }
process_logs: { workspaceId: string; processId: string; tailLines?: number; sinceSequence?: number }
process_stop: { workspaceId: string; processId: string }
project_dev: { workspaceId: string }
project_test: { workspaceId: string }
project_lint: { workspaceId: string }
project_typecheck: { workspaceId: string }
project_build: { workspaceId: string }
codex_status: {}
codex_run: { workspaceId: string; instruction: string }
codex_task_status: { workspaceId: string; codexTaskId: string }
codex_task_logs: { workspaceId: string; codexTaskId: string; tailLines?: number; sinceSequence?: number }
codex_stop: { workspaceId: string; codexTaskId: string }
```

Project tools take the workspace scope and use the detected project profile;
they do not accept arbitrary shell command strings.

### Local capability and extension tools

The detailed action enums and bounds are defined in `schemas.ts` and the
capability backends. Important invariants are:

- `shell` receives an executable plus an argument array, never a composed shell
  string, and retains foreground/background, timeout, dry-run, and task actions;
- `dom_cdp`, `accessibility`, `input_event`, `window`, `audio`, `office`, and
  scheduler operations retain their existing interactive/destructive policy;
- `vision`, `health`, and `system_info` remain truthful read-only diagnostics;
- `web_fetch` remains HTTP(S)-only and bounded by explicit byte/timeout fields;
  - `skills_*` and `mcp_*` remain full-access bridge tools and do not silently
  flatten child-server tools into the 177-tool catalog.

### Context aggregation

```ts
workspace_context: {
  query: string;
  workspaceId?: string;
  path?: string;
  intent?: 'auto' | 'debug' | 'implement' | 'review' | 'trace' | 'explore';
  mode?: 'optimized' | 'full' | 'exhaustive';
  responseTargetBytes?: number;
  pageSize?: number;
}
workspace_context_continue: { continuationToken: string; pageSize?: number }
workspace_full_scan: { workspaceId?: string; path?: string; glob?: string; pageSize?: number }
workspace_full_scan_continue: { continuationToken: string; pageSize?: number }
workspace_snapshot: { workspaceId: string }
search_all: { query: string; workspaceId?: string; path?: string; glob?: string; maxResults?: number }
read_many_files: { workspaceId?: string; files: Array<{ path: string; startLine?: number; endLine?: number }> }
```

Context pages are transport windows, not capability limits. The engine keeps
continuation state and preserves the full primitive search/read tools.

### Lossless file paging

```ts
read_file_page: {
  workspaceId?: string;
  path: string;
  startLine?: number;
  pageSize?: number;
  responseTargetBytes?: number;
}
read_file_page_continue: { continuationToken: string; pageSize?: number }
```

Paged responses always expose whether more content remains. The page adapter
does not replace or reduce the existing unrestricted trusted-workspace read
path.

### Full-visibility indexing

```ts
workspace_index: { workspaceId: string; rebuild?: boolean }
workspace_index_status: { workspaceId: string }
workspace_index_watch: { workspaceId: string; debounceMs?: number; concurrency?: number }
workspace_index_stop: { workspaceId: string }
```

Index scheduling is an execution-performance control only. It must not be used
to conceal a path from the AI; hidden, ignored, generated, dependency, and
environment files remain eligible for indexing and direct read/search.

### Roadmap extension catalog

The Phase 05–40 additive tools are defined in
[`../../packages/mcp-server/src/upgrade-catalog.ts`](../../packages/mcp-server/src/upgrade-catalog.ts).
Each entry carries its phase, permission class, tags, streamability, and
parallel-safety metadata. `tool_search` and `tool_describe` expose this metadata
without replacing the full `tools/list` contract.

### Compound execution

```ts
tool_batch: {
  parallel?: boolean;
  calls?: Array<{
    id?: string;
    tool: string;
    arguments?: Record<string, unknown>;
    dependsOn?: string[];
    timeoutMs?: number;
  }>;
  groups?: Array<{
    id?: string;
    parallel?: boolean;
    calls: Array<{
      id?: string;
      tool: string;
      arguments?: Record<string, unknown>;
      dependsOn?: string[];
      timeoutMs?: number;
    }>;
  }>;
}
```

The input contains at most 50 child calls. Results retain input order and
include per-child status, duration, error, and returned MCP response. Read-only
children can run in parallel; side-effecting children are serialized by the
early compound safety guard. Nested `tool_batch` calls are rejected.

## Change protocol

Any tool contract change must include:

1. a schema/source change;
2. a registry/tool-list test asserting the tool remains discoverable;
3. permission and annotation assertions;
4. success and failure tests for the application behavior;
5. an audit/Live Logs assertion for new compound children or side effects;
6. a fresh benchmark or regression comparison when latency, bytes, or result
   shape can change;
7. an update to this file and `docs/mcp/MCP_TOOL_CATALOG.md`.

Adding a compound tool is additive. Removing or narrowing a primitive tool is a
breaking change and is outside this upgrade roadmap.
