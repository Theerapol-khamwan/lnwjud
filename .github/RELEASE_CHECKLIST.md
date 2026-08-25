# lnwjud Release Checklist

**Current version:** `v4.10.0` - Windows installer `lnwjud-Setup-4.10.0.exe`; MCP registry **218 configurable tools / 212 advertised by default**.

Run the release verification from PowerShell at the repository root. The automated gate must fail fast on any non-zero stage and `git diff --check` must pass before packaging or publishing.

For GitHub releases, the `main` CI workflow is the single authoritative build: after the full verification gate succeeds it uploads the Windows installer, blockmap, and `latest.yml` as a SHA-scoped Actions artifact. A `v*` tag may publish only by reusing the successful CI artifact for that exact commit SHA; the Release workflow must not rerun the full verification/build/package pipeline.

## Automated evidence

- Workspace traversal and junction/reparse-point tests pass without broadening the configured path boundary.
- Secret-file policy and log/incident redaction tests pass; release evidence must never contain credentials or tokens.
- MCP local HTTP and STDIO transport tests pass, including protocol-only stdout and production handshake coverage.
- OpenAI Secure Tunnel targets the Desktop loopback HTTP MCP (`sample_mcp_remote_no_auth`) rather than a separate headless stdio runtime, preserving dynamic Active Project scope and native exact-action approval.
- Multi-workspace and multi-session Desktop MCP acceptance passes with one listener, parallel A/B flows, scoped ownership, logs, and destructive boundaries.
- Project lifecycle tests verify archive/restore/remove semantics: archived projects leave the active MCP trust boundary, removal preserves project files/history, duplicate paths restore the existing registration, and machine-root workspaces remain protected.
- Tool catalog synchronization passes with 218 configurable tools and 212 advertised by default; the six `codex_*` delegation tools remain opt-in.
- Delete/replace/overwrite/reset/restore paths require typed policy classification, exact Active Project scope, explicit confirmation where applicable, and recovery evidence before mutation.
- The exact `delete_file` operation is the only mutation eligible for scoped auto-approval; protected critical paths, workspace roots, non-empty directories, unsafe patterns, outside paths, and reparse escapes remain blocked from auto-approval.
- Approval-required mutations use an independent host exact-action approval boundary. Desktop approval is cancel-first; standalone/headless runtimes without a trusted host approval provider fail closed before dispatch.
- Arbitrary approved commands and project-owned scripts are opaque execution, not an operating-system sandbox, and are not automatically recoverable through Recovery Trash.
- Recovery Center verification covers deleted items, binary pre-replacement backups, checkpoints, rollback IDs, and the displayed local Recovery Trash path.
- Process ownership, PID identity, descendant shutdown, and bounded output limit tests pass.
- The fake Codex integration flow runs only against a disposable fixture and leaves a reviewable Git diff.
- Packaging tests verify the Windows installer configuration, portable shortcut behavior, and required runtime assets.
- The packaged-app smoke is run against the produced Windows artifact before release.

## Manual clean-machine evidence

On a clean Windows account or VM, install and launch the packaged application, confirm first-run data creation, exercise a disposable workspace and Doctor, close the application, then uninstall it. Record only pass/fail status, OS architecture, installer path, and relevant error codes.

Run one low-impact real Codex discovery/delegation check only in a disposable Git fixture. Do not automate provider quota consumption and do not read Codex credential files.

If Electron cannot launch because the host is missing a runtime or its Chromium process cannot start, preserve the exact environment failure and rerun the launch/install/uninstall portion on a clean supported Windows host. Do not weaken Electron sandbox, context isolation, or web security to make the gate pass.
