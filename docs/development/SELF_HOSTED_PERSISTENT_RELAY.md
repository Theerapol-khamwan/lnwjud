# Self-Hosted Persistent Relay and Stable URL

Status: **design for v4.11.0**  
Goal: allow lnwjud users to obtain a stable remote MCP endpoint **without being forced to buy or depend on an lnwjud-operated cloud service**.

## Short answer: does a stable URL cost money?

Not necessarily.

The lnwjud software can remain free/open/self-hostable. However, a URL that ChatGPT or another Internet-hosted AI can reach must ultimately have a public Internet ingress. That ingress must come from one of these places:

1. infrastructure the user already owns;
2. a free-tier/public tunnel provider;
3. a rented VPS/domain/service;
4. a future optional managed lnwjud relay.

A machine that is only reachable at `127.0.0.1` or a private LAN address cannot, by itself, provide a globally reachable stable HTTPS MCP URL to ChatGPT web.

## Product requirement: no mandatory lnwjud cloud

Persistent Relay must be designed as **self-host-first / bring-your-own-relay**.

Users must be able to run:

```text
lnwjud Desktop on Windows
        |
        | outbound connection
        v
self-hosted lnwjud relay
        |
        | public HTTPS MCP URL
        v
ChatGPT / Claude / other MCP client
```

The relay server package and protocol should be usable without an lnwjud account service.

A future managed service can provide convenience, but must be optional.

## Deployment mode A — Local only

```text
AI/client on same machine/LAN
        |
http://127.0.0.1:<port>/mcp
        |
lnwjud
```

Cost: **$0**.

This does not solve ChatGPT web remote access because there is no public Internet endpoint. It remains important for testing, local clients, Codex/CLI integrations, and private networks.

## Deployment mode B — Self-hosted relay on a public VPS/server

```text
ChatGPT
   |
https://mcp.example.com/p/dev/mcp
   |
Caddy/Nginx/Traefik
   |
lnwjud relay-server
   ^
   | outbound worker connection
   |
Windows lnwjud Desktop
```

The user controls the relay, domain, TLS, logs, database, and retention.

Cost depends on infrastructure. If the user already owns a public server/domain, the incremental lnwjud software cost is $0. If not, the user may need to pay for a domain and/or VPS.

Recommended shipping format:

- standalone Node/private runtime executable where practical;
- Docker image / Compose file for relay server;
- documented reverse-proxy examples;
- health endpoint;
- environment-file template with no secrets committed;
- SQLite support for single-user MVP, with a migration path to a server database if needed later.

## Deployment mode C — Cloudflare Named Tunnel

Cloudflare Tunnel is an outbound-only public ingress option and is documented by Cloudflare as available on all plans. Cloudflare also offers a Free plan. A published stable hostname requires a Cloudflare account and a domain/zone on Cloudflare. Official documentation:

- https://developers.cloudflare.com/tunnel/
- https://developers.cloudflare.com/tunnel/setup/
- https://www.cloudflare.com/plans/zero-trust-services/

Architecture:

```text
ChatGPT
  |
https://mcp.example.com
  |
Cloudflare edge / stable DNS hostname
  |
Named Cloudflare Tunnel
  |
local relay or relay-server
  |
lnwjud Desktop worker
```

A named tunnel has a persistent tunnel identity and can map a chosen public hostname to a local service. The DNS record remains even if the tunnel connector temporarily disconnects. Cloudflare documents named tunnels and DNS routing using a tunnel UUID/CNAME.

### Why not Quick Tunnel for the real feature?

Quick/temporary tunnels are good for development but use a generated hostname that can change when restarted. They therefore fail the core requirement:

> the AI profile URL must remain stable across local process restarts.

Use Quick Tunnel only for demos/tests. Use a Named Tunnel or another persistent ingress for production-like use.

### Is Cloudflare Tunnel itself the entire Persistent Relay?

No.

A stable hostname solves **endpoint identity and ingress**, but by itself it does not solve every long-running reliability problem:

- call completed locally but response was lost;
- duplicate request after reconnect;
- destructive action replay;
- durable execution lookup;
- cached tool catalog while worker is offline;
- device lease/epoch;
- profile routing independent of one connection.

Therefore v4.11 should treat a stable tunnel/hostname as an ingress option for the relay architecture, not as a replacement for Request Journal and relay lifecycle design.

## Deployment mode D — Public home server / port forwarding

A technically capable user can self-host without a tunnel provider:

```text
Internet
  |
router public IP / port forwarding
  |
HTTPS reverse proxy
  |
relay-server
```

Requirements normally include:

- public IPv4 or usable IPv6;
- router/firewall configuration;
- DNS hostname (recommended);
- TLS certificate;
- secure reverse proxy;
- careful exposure/patching.

This should be supported but not recommended as the easiest onboarding path because it exposes more network configuration to the user.

## Deployment mode E — Future managed lnwjud relay

Optional future UX:

```text
Install lnwjud
Sign in / pair
Create profile
Copy stable MCP URL
Done
```

A managed service would cost the project real infrastructure money because it must keep public endpoints/control-plane routing available even while user devices are offline. Possible future pricing or free quotas are product decisions, not requirements for the open/self-hosted implementation.

The open-source protocol must not depend on managed-only secrets or proprietary routing behavior.

## Recommended v4.11 self-host strategy

Implement in this order:

### Stage 1 — localhost relay fixture

Run `relay-server` locally and test:

```text
AI test client -> relay -> Desktop worker -> local MCP
```

No public URL yet. Proves protocol/request routing.

### Stage 2 — user-supplied public base URL

Relay config accepts:

```text
PUBLIC_BASE_URL=https://mcp.example.com
```

No Cloudflare-specific logic is required in core routing.

### Stage 3 — Docker/Compose self-host package

Example conceptual stack:

```yaml
services:
  relay:
    image: lnwjud/relay-server:<version>
    restart: unless-stopped
    volumes:
      - ./data:/data
    environment:
      - PUBLIC_BASE_URL=https://mcp.example.com
```

The real Compose file must use generated secrets and documented secure defaults.

### Stage 4 — optional Cloudflare helper

Provide a setup wizard/helper that can detect or configure a user-owned named tunnel without making Cloudflare a core dependency.

Possible UI:

```text
Remote MCP exposure

( ) I already have a public HTTPS URL
( ) Cloudflare Named Tunnel
( ) Manual/self-hosted reverse proxy
```

Do not automatically upload Cloudflare account credentials to lnwjud services.

## Stable URL design

The profile URL should be deterministic and opaque enough not to leak usernames or machine names.

Recommended format:

```text
https://mcp.example.com/p/<profile-id>/mcp
```

Example:

```text
https://mcp.example.com/p/01K4ZP7Y8A.../mcp
```

A human display name such as `Development` should be metadata, not the sole security boundary or immutable URL identity.

For a single-user self-host server, a shorter route may be offered:

```text
https://mcp.example.com/mcp
```

Internally it still maps to a persistent profile ID.

## DNS and process lifecycle

Stable URL means:

```text
DNS hostname / profile route             stays
relay-server process                     may restart
Desktop worker connection                may restart
Desktop MCP local port                   may change
Windows machine network address          may change
```

The public hostname must never embed the ephemeral local MCP port.

The Desktop reports/reconnects to the relay; the relay routes to the active worker. This is why moving the stable identity above the machine lifecycle matters.

## Local-first security rules

Self-hosting must not weaken current lnwjud safety.

- public relay never gets filesystem access by itself;
- local permission engine remains final authority;
- Full/Balanced/Safe still work locally;
- destructive policy remains local;
- credentials for public clients and worker registration are separate;
- all public endpoints require TLS outside explicit localhost development;
- worker should connect outbound only;
- relay binds only the profile/device it is authorized for;
- credentials are rotatable/revocable;
- no plaintext secrets in Git/config examples;
- logs are redacted and bounded;
- request journal protects against replay/duplicate effects.

## Authentication progression

### Development/self-host MVP

A generated high-entropy profile credential and separate generated worker credential over HTTPS is acceptable for proving the architecture.

### Production public MCP

Add standards-compatible authorization/OAuth as required by target MCP clients. Keep auth implementation at the public profile boundary so changing auth providers does not rewrite the local tool runtime.

## What the user should have to configure

Self-host mode should eventually require approximately:

1. choose/run relay-server;
2. obtain a public HTTPS hostname using their preferred method;
3. copy the relay URL/token or pair the Desktop;
4. create one Persistent Profile;
5. add the resulting MCP URL to the AI client once.

After that, restarting lnwjud must not require changing the AI connector URL.

## Cost matrix

| Mode | Mandatory lnwjud fee | Possible external cost | Stable public URL | Works without lnwjud cloud |
| --- | ---: | --- | ---: | ---: |
| Local only | $0 | none | no public URL | yes |
| Self-hosted public server | $0 | server/domain if not already owned | yes | yes |
| Cloudflare Named Tunnel + own domain | $0 lnwjud fee | domain; Cloudflare plan can be Free subject to provider terms | yes | yes |
| Home server + public IP/domain | $0 | ISP/domain may cost | yes | yes |
| Managed lnwjud Relay (future) | TBD | managed-service plan if offered | yes | no, by choice |

Provider pricing/limits can change. The core project must avoid assuming a specific third-party free tier as a permanent protocol guarantee.

## Recommendation

For the open/local user story, make the **reference deployment**:

```text
lnwjud Desktop
   -> outbound worker connection
self-hosted relay-server
   -> user's own stable HTTPS hostname
AI client
```

Then document Cloudflare Named Tunnel as the easiest optional ingress path for users who do not want to open router ports or maintain a public VPS ingress.

This gives lnwjud the stable profile abstraction while keeping the product local-first and self-hostable.
