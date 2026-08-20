# Task 3 implementer report — incident evidence export

## Delivered

- Added a user-triggered Desktop incident capture/export with a typed IPC contract, trusted-sender handler, save dialog, and atomic JSON write.
- Added schema v1 bounded evidence reports: capture/app/tunnel versions (tunnel client version is `null` when unavailable without invoking the configured executable), updater tail, tunnel state/source/message, parsed instance/request IDs, paired MCP calls and orphan markers, bounded/redacted tunnel tail, relevant-PID process/listener collector results, and loopback health evidence.
- Added exact classifications and precedence: `local_tool_failed`, `tunnel_disconnected`, `remote_turn_stopped`, `healthy_or_inconclusive`. The remote classification is reachable only from this manual capture route after a successful local result and healthy loopback; idle status remains inconclusive.
- Added Live Logs capture action plus Thai/English visible classification summary. MCP log formatting now preserves `callId` for correlation.

## TDD evidence

- RED: `apps/desktop/tests/incident-report.test.ts` was added before `incident-report.ts`; focused Desktop run failed because the module did not exist (1 failed suite; the other 67 Desktop tests passed).
- GREEN: focused incident suite covers four classifications, conflict precedence, idle/manual gate, interleaved pairing and orphan calls, malformed ID parsing, bounds/redaction, partial collector errors, and export cancel/success. It passes: 12 incident tests, 79 Desktop tests total.
- A redaction gap exposed by the focused suite (authorization value after a `Bearer` prefix) was fixed and rerun green.

## Verification gates

- `corepack pnpm@10.15.0 --filter @lnwjud/desktop test -- incident-report.test.ts` — passed (16 files, 79 tests).
- `corepack pnpm@10.15.0 lint` — passed.
- `corepack pnpm@10.15.0 typecheck` — passed.
- `corepack pnpm@10.15.0 test` — passed across workspace packages.
- `corepack pnpm@10.15.0 build` — passed, including Desktop declarations/preload/renderer bundles.
- `git diff --check` — passed.

## Self-review and concerns

- The collectors are injectable and relevant-PID scoped; they only run read-only PowerShell queries and report structured unavailability/error without failing export. No environment, arbitrary command line, full logs, file content, headers, or secret values are exported.
- Health reuses the active local MCP loopback endpoint and adds no port. Tunnel-client version intentionally remains unavailable (`null`) rather than spawning a configured external executable during capture.
- No live tunnel process, network mutation, or external state was touched. Desktop-UI behavior is build/typechecked; no live Electron session was launched.

## Review-fix addendum

- RED: strengthened structured-correlation and tunnel-health tests first. The focused run had 14 incident tests with 11 expected failures because the old classifier used display text and loopback MCP state rather than structured lifecycle/tunnel evidence.
- GREEN: 14 incident-report tests and 9 tunnel-controller tests now pass (83 Desktop tests total). The report reads only structured MCP start/completion metadata, handles repeated `callId` queues, preserves structured tunnel IDs, uses a profile/log-resolved health endpoint, and scopes listener queries before enumeration.
- Tunnel health uses the existing `health.listen_addr` in `lnwjud.yaml`, or the runtime health listener recorded by tunnel-client when the configured address is dynamic; it never uses the Desktop local MCP listener or invents a port. Missing/dynamic-unresolved health is explicit `unavailable`, so it cannot yield `remote_turn_stopped`.
- Client version discovery uses file-version metadata from the configured existing executable (read-only PowerShell metadata query, never executing the binary), with a bounded structured unavailability reason.
- Dashboard Control Center and Live Logs share the manual capture action/status. Only a successful write updates classification and timestamp; cancel leaves the previous capture intact and reports neutral cancellation status.

## Second review-fix addendum

- RED: 19 focused incident cases produced four expected failures for unrecognized tunnel lifecycle variants and the missing exported capture timestamp.
- GREEN: structured completion status is now allowlisted (`SUCCESS`, known failure codes, `FATAL`, otherwise `UNKNOWN`); unknown or malformed completion evidence cannot produce local/remote classification. Tunnel failure normalization covers TTL, stdio process/command termination, shutdown, and disconnect variants. The typed export result carries the report's exact `capturedAt` only on success.
- Exact duplicate MCP delivery remains deduped, while timestamp/fingerprint-based activity identities retain repeated call IDs as separate lifecycle occurrences.

## Completion review-fix addendum

- RED was re-established before each completion change. The first regression batch produced 20 expected failures with 86 passing Desktop tests. Three focused follow-up cycles produced 2 expected failures each: 45 passing for structured bare status and raw-ID correlation, 37 passing for synchronized chronology and exported lifecycle evidence, then 38 passing for descending audit order and the actual `start(A), completion(B)` LogHub path.
- MCP correlation is now a single chronological occurrence pass. Starts create report entries in place, completions match FIFO by raw call identity, exact event deliveries dedupe, distinct post-terminal evidence before a newer start marks the occurrence `conflict`/`UNKNOWN`, and source sequence plus start/completion timestamps remain bounded in the report. Missing, malformed, orphaned, unknown, and conflicting latest evidence cannot produce local or remote attribution.
- LogHub identities use call ID, phase, and the authoritative event timestamp/startedAt (audit ID only as a legacy fallback). Descending repository rows and in-flight state are merged chronologically, the persisted work-log view wins exact ties, and two sequential invocations reusing a call ID remain distinct without duplicate unmatched starts.
- Every tunnel LogHub entry carries one bounded lifecycle category. Structured `event`/`status`/`reason` values are normalized first; unstructured fallback requires TTL, stdio, tunnel-client/tunnel/control-plane, or websocket protocol context. The report exports the category, and classification consumes categories rather than raw display keywords. The false-positive matrix keeps `previous task stopped cleanly` and `shutdown documentation loaded` as `other`.
- Report output receives a final recursive safe-and-bound pass over every string. Serialization tests cover case-insensitive snake, kebab, and camel credential keys; Basic/Bearer authorization; multiline headers; assignments; JSON; URL queries; X-Api-Key; and unique markers across versions/reasons, updater/state, tunnel IDs/tail, MCP calls, processes, listeners, and collector errors. All markers are absent and all report strings are at most 512 characters.
- Final focused GREEN: incident, LogHub, work-log renderer, and i18n suites passed 54/54; Desktop typecheck passed. Repository gates passed: lint, full typecheck, build, and `git diff --check`. The first full test attempt hit a transient Windows `EBUSY` cleanup race in an unchanged shell test; that test then passed 11/11 in isolation, and a fresh full workspace test completed with explicit exit 0 (Desktop 110/110).
- No MCP port, deadline, TTL, tunnel execution, live process, network, or external state was changed. The existing trusted/atomic export, configured tunnel health/version discovery, Dashboard/Live Logs action, PID-scoped collectors, updater, ActivityTracker, and lock behavior remain in place. Live Electron interaction was not run; renderer behavior is covered by focused tests, typecheck, and the production build.
