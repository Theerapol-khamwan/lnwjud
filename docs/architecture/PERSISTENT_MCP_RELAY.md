# Persistent MCP Relay Architecture

Status: **proposed for v4.11.0**  
Design principle: **Chat/AI connection identity must not be the Desktop process identity.**

## Why this layer exists

lnwjud already owns the difficult local part of the problem: tools, permissions, workspaces, durable tasks, local HTTP MCP, auditing, recovery, browser/Windows automation, Git, WSL, and process lifecycle. The relay must not duplicate these responsibilities.

The relay is a routing/control-plane layer that gives an AI client a persistent MCP profile endpoint while one local lnwjud Desktop acts as a reconnectable worker behind that endpoint.

## Current foundation

The current source already provides useful building blocks:

- `apps/desktop/src/main/mcp-lifecycle.ts` owns an application-global loopback HTTP MCP lifecycle.
- `packages/mcp-server/src/http.ts` exposes `/mcp` on loopback and includes modern plus legacy session handling.
- `apps/desktop/src/main/tunnel-controller.ts` already proves outbound remote connectivity, ownership locking, health checks, bounded reconnect, and separation between the Desktop HTTP MCP and the OpenAI tunnel client.
- `packages/capabilities/src/durable-shell-task-store.ts` provides process-independent durable background tasks.
- activity/workspace/session attribution already exists and can be extended with relay request IDs rather than replaced.

## Architectural boundary

```text
Public Internet

AI client
   |
   | HTTPS MCP
   v
Persistent Profile Endpoint
   |
   | routing / auth / catalog / lease
   v
Relay Server
   |
   | outbound worker channel
   v
Desktop Relay Agent
   |
   | 127.0.0.1 only
   v
Existing Desktop MCP HTTP endpoint
   |
   v
Existing lnwjud application/tool runtime
```

The relay server must never directly access user files, Windows UI, local credentials, or workspaces. It forwards authorized MCP operations to the selected local worker; the existing local permission engine remains authoritative.

## Identity hierarchy

```text
Installation / Device
  device_id

Profile
  profile_id
  stable public endpoint
  active_device_id

Worker connection
  connection_id
  epoch
  lease

MCP request
  request_id
  idempotency_key
  deadline
```

These identities solve different problems and must not be collapsed into one socket/session identifier.

## Persistent profile

A profile is the logical object an AI client connects to.

Properties:

- stable profile ID;
- stable public path/URL;
- current validated tool catalog;
- authentication policy;
- one active device in the v4.11 MVP;
- current device connectivity state;
- last-seen metadata.

The profile remains valid when its device is temporarily offline.

## Worker channel

The Desktop establishes an outbound authenticated connection to the relay. No inbound port on the Windows host is required.

The protocol must support:

- HELLO / authentication;
- profile binding;
- device identity;
- catalog hash/version;
- heartbeat;
- request dispatch;
- progress/result frames;
- cancellation;
- reconnect resume metadata;
- controlled shutdown;
- protocol versioning.

WebSocket is a reasonable first implementation because it is broadly deployable and works through common reverse proxies/tunnel providers. Message contracts should remain transport-neutral enough to move to another duplex transport later.

## Lease and epoch

A boolean `connected` flag is not sufficient for routing safety.

Each active worker binding contains:

```text
profile_id
device_id
connection_id
epoch
last_heartbeat
lease_expires_at
```

When a worker reconnects, the epoch increases. The relay rejects frames or results from a stale epoch. This prevents a delayed old connection from completing work after a newer connection has taken ownership.

Suggested first values:

- heartbeat: 5 seconds;
- lease: 20 seconds;
- interactive reconnect grace: 30 seconds;
- reconnect backoff: 250 ms to 15 seconds plus jitter.

These are defaults, not protocol constants.

## Local MCP lifetime vs relay lifetime

The Desktop relay agent must use the existing application-global HTTP MCP rather than starting a fresh MCP server for every reconnect.

A network event must not automatically imply:

- stopping/restarting Desktop MCP;
- killing managed processes;
- cancelling durable tasks;
- clearing tool catalog;
- changing Active Project;
- changing permission profile.

This is a critical invariant.

## Request envelope

Every routed call should carry a relay envelope independent of MCP transport-specific metadata:

```json
{
  "request_id": "uuid",
  "idempotency_key": "opaque-bounded-token",
  "profile_id": "profile-id",
  "device_id": "device-id",
  "connection_epoch": 42,
  "deadline": "2026-08-25T12:00:00Z",
  "tool_name": "write_file",
  "input_hash": "sha256:..."
}
```

The envelope is not authorization to bypass local tool policy. It supplies distributed execution identity and replay protection.

## Request journal

The local worker should record distributed execution state before dispatching side effects.

Suggested states:

```text
RECEIVED
DISPATCHED
RESULT_COMMITTED
DELIVERED
FAILED_TERMINAL
```

For large results, store bounded metadata plus a reference to an existing local durable result rather than copying arbitrary output into an unbounded journal.

### Duplicate request behavior

- same `request_id` + same input hash + committed result: return existing result/receipt;
- same `request_id` + different input hash: reject;
- request marked dispatched with uncertain side effect: resolve according to tool replay class; do not blindly execute again;
- destructive/non-idempotent call with committed execution receipt: never auto-repeat.

## Replay policy classes

### Safe reads

Examples: `read_file`, `search_text`, `git_status`, status/inspection calls.

Can be retried after reconnect subject to original deadline and authorization context.

### Idempotent writes

Only operations whose repeated execution with the exact same input is known to produce the same intended final state. Retry requires the same idempotency key and input hash.

### Managed execution

For `shell`/process-like operations, the journal should bind the remote request to an existing managed/durable task ID. Reconnection retrieves the existing execution instead of spawning a second process.

### Destructive/non-idempotent

Delete/discard/one-shot external effects must fail closed when execution state is ambiguous. If a committed receipt exists, replay returns the committed receipt/result rather than executing again.

## Tool catalog ownership

The public profile owns a **validated cached catalog**, while the Desktop is the source of truth for updates.

Worker HELLO contains:

```text
runtime_version
catalog_version
catalog_hash
```

If the hash matches, no catalog transfer is necessary. If it changes, the relay validates a bounded catalog update and atomically replaces the prior catalog.

An offline device does not delete the profile catalog. This lets `tools/list` remain stable and makes `DEVICE_OFFLINE` a routing state rather than a missing-connector state.

## Offline and reconnect behavior

### Device reconnecting

The relay can hold an interactive request for a bounded grace period. It must honor the request deadline and must not create an unbounded queue.

### Device offline

The profile endpoint remains alive and returns a typed retryable execution error. Catalog/list operations may continue from the cached validated catalog.

### Device disabled/revoked

Return a non-retryable authorization/availability error. Never automatically re-enable a revoked device because it reconnects.

## Authentication model

The architecture must support both self-hosted and future managed deployment.

At minimum separate:

1. **AI/Profile authorization** — who may call the public MCP profile.
2. **Device/Worker authorization** — which local installation may register and serve the profile.

A device credential must not automatically function as an AI profile credential and vice versa.

For the first self-hosted development implementation, a strong generated bearer credential may be used behind TLS. OAuth client authorization can be added without changing the profile/worker routing model. Production public endpoints should prefer standard MCP-compatible authorization and revocation flows.

## Local-first data policy

Default relay/control-plane storage should contain only what routing requires:

- account/profile/device identifiers if enabled;
- connectivity/lease state;
- catalog metadata/content;
- bounded request identity/state;
- bounded operational diagnostics.

By default it should **not** persist:

- source files;
- file contents;
- screenshots;
- clipboard contents;
- shell output;
- full tool arguments beyond what the distributed journal strictly needs;
- local Work Log/audit payloads;
- Windows credentials;
- private keys.

Self-host users control their own relay database and retention.

## Deployment modes

The same relay protocol should support:

```text
Local only
OpenAI Secure MCP Tunnel
Self-hosted Persistent Relay
Managed Persistent Relay (future)
```

OpenAI Secure Tunnel remains an independent fallback implementation. Persistent Relay must not be implemented by weakening or removing the current tunnel path.

## Stable URL requirement

A stable public URL is a DNS/TLS/routing property, not a property of the local Windows process. The hostname should point to a continuously addressable relay/edge route. The worker can disconnect and reconnect behind it.

For self-hosting this can be achieved with:

- a public VPS/server + domain + HTTPS reverse proxy;
- a home/public server with port forwarding + domain + TLS;
- an outbound named tunnel with stable DNS, such as a Cloudflare Named Tunnel;
- another compatible public ingress chosen by the user.

A random temporary/quick tunnel URL is useful for testing but does not satisfy persistent profile identity.

## Failure model

The design must explicitly test:

- relay process restart;
- worker process restart;
- local MCP restart;
- network loss before dispatch;
- network loss after dispatch;
- network loss after local commit but before remote result delivery;
- duplicate request;
- delayed stale-epoch result;
- worker reconnect during grace window;
- worker offline beyond grace;
- catalog update failure;
- auth token rotation/revocation;
- relay database restart/recovery.

## Observability

Expose locally and optionally at relay level:

- profile state;
- worker state;
- device ID;
- epoch;
- last heartbeat;
- reconnect count/backoff;
- current catalog hash;
- request ID correlation;
- request journal state;
- replay/dedupe count;
- offline/reconnecting errors.

Never expose secrets in logs.

## Security boundaries retained from lnwjud

Persistent Relay is not an alternate permission engine. The local runtime still owns:

- Active Project and canonical path checks;
- Full/Balanced/Safe profiles;
- destructive command classification;
- host/native approval boundaries where required;
- critical path protection;
- Recovery Trash/checkpoints;
- managed process ownership;
- workspace/session attribution;
- plugin/capability policy.

A relay bug must not be able to turn a denied local action into an allowed one.

## Core acceptance statement

The architecture is acceptable only when this scenario works repeatedly:

```text
AI connector configured once
        |
Desktop/network disconnects
        |
profile URL stays the same
        |
Desktop reconnects
        |
next tool call works
        |
no connector URL edit required
```

Transport continuity is desirable; logical profile continuity is mandatory.
