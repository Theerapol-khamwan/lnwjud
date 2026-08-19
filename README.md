<p align="center">
  <img src="assets/logo/logo-256x256.png" width="160" alt="lnwjud logo" />
</p>

<h1 align="center">lnwjud</h1>

<p align="center">
  <strong>Windows-first Local Development & MCP Gateway for AI Agents</strong><br />
  <em>Supercharge ChatGPT, Codex, and Claude with native Windows capabilities, secure tunnels, and live monitoring.</em>
</p>

---

lnwjud is a Windows-first local development gateway that exposes an approved
development workspace through [Model Context Protocol (MCP)](https://modelcontextprotocol.io).
It lets ChatGPT, Codex, or another MCP client inspect source code, search a
project, review Git state, edit files, run approved project commands, inspect
process logs, and optionally delegate work to the local Codex CLI.

The code and commands remain on the Windows computer. ChatGPT web does not
receive a public shell and does not read the local Codex configuration. For a
ChatGPT web connection, OpenAI Secure MCP Tunnel forwards MCP requests to a
local lnwjud process; the tunnel is outbound-only.

## v4.0.0 release status

Release `v4.0.0` ships the additive God-Tier local-first gateway slices while keeping the existing security and primitive-tool contracts intact. The current runtime advertises 208 tools with the historical 184-tool catalog preserved as a compatibility baseline. It includes:
- Scoped WSL execution and registered-workspace path translation with task ownership, timeout, cancellation, and audit boundaries.
- Set-of-Marks annotated capture with expiring observation hashes and approval-gated target actions.
- Trace-correlated health, task, NDJSON, and SQLite audit metadata.
- Deterministic semantic tool routing with ranked candidates, reason codes, permission metadata, and local-only fallback behavior.
- A Windows OCR helper boundary with truthful unavailable behavior when package identity or the signed sparse package is not present.
- Branded Windows tray mode with background service persistence.
- Permission enforcement for Desktop MCP capability tools with full-access stdio/tunnel profiles.
- Compound/parallel workflows, persistent indexing, and Context Economy Engine.
- Stable external tunnel detection and DPAPI-encrypted credential management.

See the [phase completion checklist](docs/architecture/ROADMAP_PHASE_STATUS.md) and the [foundation benchmark](docs/benchmarks/PHASE-05.md).

The v2.2 visibility contract separates discovery efficiency from access:
automatic filename/text search, indexing, and watchers skip vendor/build/cache
trees, binary files, generated bundles, and source maps to save I/O and context
quota. `.env` remains available as relevant configuration. This is not a deny
rule: `read_file`/`read_many_files`, full scans, and explicit search/index
requests can still inspect `.git`, `dist`, `node_modules`, binaries, and any
other path allowed by the existing workspace boundary. Context responses remain
bounded or paged, and report continuation/telemetry instead of silently
discarding results. Desktop MCP still applies the selected Permission profile
to mutating, executable, dangerous, and capability tool calls. Packaged stdio
and Secure Tunnel MCP use the full profile so Codex/AI can inspect permitted
workspace paths without changing the Desktop profile.

> **Security boundary:** lnwjud is still path-checked and policy-checked. It is
> not an administrator shell. Unrestricted mode is **on by default** so every
> local drive can be used. Destructive operations are centrally gated before backend execution and require explicit human
> confirmation (`userConfirmed: true`). This includes filesystem deletion, destructive Git, opaque child MCP/agent calls, HTTP DELETE, destructive shell/process commands, mutating Office actions, and opaque UI actions that can trigger deletion. Disk format / shutdown stay hard-blocked.

## ⚡ Quick Setup: Zero to ChatGPT in 3 Minutes

Choose your preferred setup method:
- **[Option A (Recommended for End-Users): Download Pre-built Release & Configure via GUI](#-option-a-end-user-quick-setup-pre-built-release)** — No Node.js or terminal build required; configure keys directly in the Lnwjud desktop UI!
- **[Option B (For Developers): Build from Source & Script Automation](#%EF%B8%8F-option-b-developer-setup-build-from-source)** — Clone the repo, build with pnpm, and customize the low-level pipelines.

---

### 🚀 Option A: End-User Quick Setup (Pre-built Release)

Follow this 4-step quick start to connect ChatGPT or any AI agent to your Windows PC using the official pre-built installer:

#### Step 1: Download & Install Lnwjud Desktop
1. Download the latest installer (`lnwjud-Setup-4.0.0.exe`) from **[GitHub Releases](https://github.com/engasnm111/lnwjud/releases/latest)**.
2. Run the installer (it automatically creates start menu and desktop shortcuts).
3. Launch **Lnwjud Agent Control Center**.

#### Step 2: Create a Remote Tunnel & Get Your Key
Choose your preferred tunnel provider:
- **Using OpenAI Secure MCP Tunnel:**
  1. Open [OpenAI Platform > Organization Settings > Tunnels](https://platform.openai.com/settings/organization/tunnels) and click **Create Tunnel** (name it `lnwjud`).
  2. Copy the generated **Tunnel ID** (e.g. `tun_abc123...`).
  3. Go to [OpenAI Platform > API Keys](https://platform.openai.com/settings/organization/api-keys) and create a key with permission: **Tunnels: Read + Use**.
  4. Download `tunnel-client.exe` from [OpenAI tunnel-client releases](https://github.com/openai/tunnel-client/releases) and place it in a local folder (e.g. `C:\tools\tunnel-client.exe`).
- **Using Cloudflare Tunnel / Reverse Proxy:**
  1. Create a Cloudflare Tunnel pointing to local MCP HTTP port `http://127.0.0.1:39200/mcp`.
  2. Copy your Tunnel Token / API Secret and the path to `cloudflared.exe`.

#### Step 3: Enter Credentials in Lnwjud Settings (Directly in the App!)
1. In Lnwjud Desktop, click **Settings (ตั้งค่า)** from the sidebar navigation.
2. Scroll to the **Remote Tunnel & Cloudflare Settings** card.
3. Fill in your tunnel settings directly into the form fields:
   - **Tunnel ID / Subdomain**: Paste your OpenAI Tunnel ID or Cloudflare hostname.
   - **Tunnel Secret / API Key**: Paste your Runtime API key or Cloudflare token (click the 👁️ eye toggle anytime to reveal/mask the key).
   - **Tunnel Client Path**: Enter the path to `tunnel-client.exe` or `cloudflared.exe`.
4. Click **Save Preferences (บันทึกการตั้งค่า)**.
   > *Security note: Lnwjud automatically encrypts and stores your keys locally using Windows DPAPI (Data Protection API) tied to your Windows account.*
5. Toggle **Start Tunnel** to activate the connection.

#### Step 4: Add the MCP Connector in ChatGPT & Start Calling Tools!
1. Open [ChatGPT](https://chatgpt.com) and switch to your developer workspace.
2. Go to **Settings > Connected Apps / Developer Settings** > **Create App** (or add MCP Server).
3. Choose **Tunnel** and select your `lnwjud` tunnel.
4. Verify the 184-tool catalog loads (e.g. `read_file`, `read_file_page`, `search_all`, `workspace_index`, `context_economy_stats`, `git`, `shell`, `dom_cdp`, `window`, `vision`, `system_info`).
5. Open a new chat, enable the **lnwjud** plugin/tool, and test:
   > *"Check git status of my workspace, list active processes, and summarize recent code changes."*
6. Watch real-time tool execution logs, commands, and audit records stream live in the **Lnwjud Live Log Hub**!

---

### 🛠️ Option B: Developer Setup (Build from Source)

Follow this walkthrough if you want to clone the repo, develop custom extensions, or run the stdio pipeline directly:

#### 1. Clone & Install Dependencies
Open PowerShell on your Windows machine:
```powershell
# Clone repository
git clone https://github.com/engasnm111/lnwjud.git
Set-Location .\lnwjud

# Enable Corepack and install pinned dependencies
corepack enable
corepack pnpm@10.15.0 install --frozen-lockfile

# Initialize local environment configuration
Copy-Item .env.example .env
```

#### 2. Build lnwjud & Test the Desktop Dashboard
```powershell
# Build all packages and the desktop application
corepack pnpm@10.15.0 build

# Launch the desktop Agent Control Center
corepack pnpm@10.15.0 desktop
```
*(Optional: Run `corepack pnpm@10.15.0 package:windows` to generate a standalone Windows NSIS installer in `apps/desktop/dist/installers/`)*

#### 3. Setup OpenAI Secure MCP Tunnel & Runtime API Key
1. **Download `tunnel-client`:**
   - Download `tunnel-client.exe` from [OpenAI tunnel-client releases](https://github.com/openai/tunnel-client/releases).
   - Place it in `$env:USERPROFILE\Downloads\tunnel\tunnel-client.exe` (or your preferred directory).
2. **Create a Tunnel on OpenAI Platform:**
   - Visit [OpenAI Platform > Organization Settings > Tunnels](https://platform.openai.com/settings/organization/tunnels).
   - Click **Create Tunnel**, name it `lnwjud`, and link it to your target ChatGPT Workspace.
   - Note the generated `Tunnel ID` (e.g. `tun_abc123...`).
3. **Generate a Tunnel Runtime API Key:**
   - Go to [OpenAI Platform > API Keys](https://platform.openai.com/settings/organization/api-keys).
   - Create a new restricted key with permission: **Tunnels: Read + Use**.
   - Copy the API key.

#### 4. Store Your Runtime Key & Configure the Profile
1. **Save your encrypted key with Windows DPAPI (run once):**
   ```powershell
   New-Item -ItemType Directory -Force -Path "$env:APPDATA\tunnel-client"
   Read-Host 'Paste Tunnel Runtime API Key' -AsSecureString | ConvertFrom-SecureString | Set-Content "$env:APPDATA\tunnel-client\lnwjud.runtime.secret"
   ```
2. **Initialize and edit profile configuration:**
   ```powershell
   & "$env:USERPROFILE\Downloads\tunnel\tunnel-client.exe" init --profile lnwjud
   ```
   Open `$env:APPDATA\tunnel-client\lnwjud.yaml` and configure it (ensure forward slashes `/` are used for Windows file paths):
   ```yaml
   profile: lnwjud
   tunnel_id: "tun_your_tunnel_id_here"
   mcp:
     commands:
       - channel: main
         command: "C:/Users/<User>/AppData/Local/Programs/lnwjud/lnwjud-mcp-stdio.cmd"
     connection_max_ttl: 168h0m0s
   ```
   Use the packaged `lnwjud-mcp-stdio.cmd` launcher for the tunnel. It starts
   the direct Node MCP stdio server and does not open the desktop GUI.

#### 5. Launch the Tunnel Service
Start the resilient tunnel loop (with auto-reconnect, long TTL, and live dashboard sync):
```powershell
.\scripts\start-lnwjud-tunnel.ps1
```
*Or simply double-click [`scripts\start-lnwjud-tunnel.bat`](scripts/start-lnwjud-tunnel.bat).*

#### 6. Connect ChatGPT & Start Calling Tools
1. Open [ChatGPT](https://chatgpt.com) and switch to your developer workspace.
2. Navigate to **Settings > Connected Apps / Developer Settings** > **Create App**.
3. Select your tunnel `lnwjud` from the list.
4. Verify that the 184-tool catalog loads (including `read_file`, `read_file_page`, `search_all`, `workspace_index`, `context_economy_stats`, `git_status`, `shell`, and `system_info`).
5. Start a new conversation, activate the **lnwjud** tool, and try:
   > *"Inspect my current project, check git status, and summarize the last 5 commits."*
   > *"Find all TypeScript files that import `@lnwjud/domain`."*
6. Watch real-time execution logs and audits stream directly into the **lnwjud Live Log Hub**!

---

## Choose a connection mode

| Client | Connection | What must be running on Windows | Best for |
| --- | --- | --- | --- |
| ChatGPT web | OpenAI Secure MCP Tunnel | tunnel-client and a packaged stdio-capable lnwjud launcher | A ChatGPT chat working on a private local project |
| ChatGPT desktop / Codex CLI / IDE | Local stdio MCP | packaged `lnwjud-mcp-stdio.cmd` | Lowest-latency local development |
| Desktop dashboard or a local MCP client | Loopback Streamable HTTP | The lnwjud desktop app and its local MCP connection | Debugging and local browser/UI capabilities |
| Responses API or another supported OpenAI surface | Secure MCP Tunnel or private HTTP | A running tunnel client or private HTTP MCP server | Programmatic tool calls |

## Run in the Windows system tray

Closing the main lnwjud window hides it instead of stopping the Desktop runtime,
MCP listener, Live Logs, or tunnel services. The branded lnwjud icon remains in
the Windows notification area while the app works in the background.

Right-click the tray icon to use:

- **เปิดหน้า** / **Open page** — show and focus the main dashboard.
- **ตรวจอัปเดต** / **Check for updates** — ask the packaged app to check GitHub Releases.
- **ปิดโปรแกรม** / **Quit program** — stop services and exit lnwjud completely.

### Important: the stdio launcher

The tunnel command must start the stdio MCP entrypoint, not the Electron
dashboard. The packaged v3.0.0 build ships this direct launcher:

```text
lnwjud-mcp-stdio.cmd --workspace E:\lnwjud
```

If the executable opens the graphical dashboard instead of waiting for MCP
messages, it is a desktop-only entrypoint and cannot be used as the tunnel
command. Use the packaged stdio launcher or the desktop HTTP connection.

## What must be configured

1. **Local gateway:** this repository or the Windows installer.
2. **Local policy:** registered workspaces and a permission profile.
3. **OpenAI Platform:** a tunnel, its workspace/organization associations, and a
   runtime API key with tunnel-use permission.
4. **ChatGPT developer app:** a private app that selects the tunnel and exposes
   the MCP tools to a chat.

ChatGPT web sees the remote connector only. The Windows process and the tunnel
client must remain running.

## Requirements

### Windows computer

- Windows x64.
- Node.js 24 LTS (engine range >=24.0.0 <25) when building from source.
- Git, Corepack, and the pinned package manager pnpm@10.15.0.
- PowerShell 7 is recommended; Windows PowerShell 5.1 is sufficient for the
  examples here.
- ripgrep (rg) is recommended.
- The local Codex CLI is optional. lnwjud reports its availability without
  reading Codex credential files.

### OpenAI account and workspace

For the ChatGPT web path:

- Developer mode must be enabled in the target ChatGPT workspace.
- You need an OpenAI Platform organization with tunnel access.
- Tunnels Read + Manage is required to create/edit a tunnel.
- Tunnels Read + Use is required to run tunnel-client and select a tunnel while
  creating the ChatGPT developer app.
- The tunnel must be associated with the target ChatGPT workspace, not only with
  a personal Platform organization.

Platform tunnel permissions and ChatGPT Developer mode are separate controls.
Ask the ChatGPT workspace administrator and Platform organization owner/RBAC
administrator when a control is unavailable.

### Network

The machine running tunnel-client needs outbound HTTPS to api.openai.com:443
(or mtls.api.openai.com:443 when control-plane mTLS is configured) and local
reachability to the configured MCP command or URL. It does not need an inbound
firewall rule or a public port.

## Install from source

### Clone and install dependencies

```powershell
git clone https://github.com/engasnm111/lnwjud.git
Set-Location .\lnwjud
corepack pnpm@10.15.0 install --frozen-lockfile
```

Do not silently upgrade the package manager: the lockfile is pinned to
pnpm@10.15.0.

### Configure Environment

```powershell
Copy-Item .env.example .env
```

### Build and run the desktop dashboard

One command from the repository root:

```powershell
Set-Location .\lnwjud
corepack pnpm@10.15.0 desktop
```

This builds the desktop app and opens the Agent Control Center. MCP HTTP
auto-starts on launch (no Start Connection click required). The dashboard owns
the SQLite state, workspace registry, permission profile, work-log audit
records, loopback MCP lifecycle, and Secure Tunnel controls.

Optional environment:

```powershell
$env:LNWJUD_DATA_PATH = "$env:LOCALAPPDATA\lnwjud"
$env:LNWJUD_WORKSPACE = "D:\projects\my-app"
corepack pnpm@10.15.0 desktop
```

Use the same `LNWJUD_DATA_PATH` for desktop UI and the packaged stdio launcher
so ChatGPT tool activity appears in the Work Log. The launcher is the same
direct MCP entrypoint used by the Codex/tunnel integration.

### Build a Windows installer

```powershell
Set-Location .\lnwjud
corepack pnpm@10.15.0 package:windows
```

The x64 NSIS installer is written to:

```text
apps/desktop/dist/installers/lnwjud-Setup-4.0.0.exe
```

The installer is per-user by default. A common installed executable path is:

```text
C:/Users/<WindowsUser>/AppData/Local/Programs/lnwjud/lnwjud.exe
```

Always use the path shown by the installed shortcut or Get-Command.

## Configure the local desktop application

### Add a workspace

1. Start lnwjud (`pnpm desktop` or the installed app).
2. On Home or Projects, add the project directory path.
3. The selected project is persisted; switching projects restarts MCP automatically.
4. Desktop MCP uses the selected Permission profile; stdio/tunnel MCP remains full-access for AI clients.
5. Run Doctor from the sidebar if a dependency is reported missing.

Every file operation resolves the supplied path against a registered workspace,
canonicalizes existing parents/targets, rejects traversal and reparse-point
escapes, and applies the secret policy after resolution.

### Permission profiles

| Profile | READ | WRITE | EXECUTE | DANGEROUS | Intended use |
| --- | --- | --- | --- | --- | --- |
| safe | allow | ask | ask | deny | Read and approve changes carefully |
| balanced | allow | allow | allow | ask | Normal development |
| full | allow | allow | allow | allow | Explicitly trusted local automation |
| custom | configured | configured | configured | configured | Host-defined policy |

Desktop MCP honors the selected profile for every MCP tool, including local
capabilities. The packaged stdio/tunnel runtime intentionally uses the
**full** profile so Codex/AI can inspect all workspace paths, including
`.env`, and does not overwrite the Desktop profile stored in SQLite.
Unrestricted mode is on by default (every fixed drive is a machine root).
Filesystem deletion-style commands require confirmation. Disk format, shutdown,
and reboot stay hard-blocked. Destructive Git forms including `rm` / `clean` /
`reset` require explicit chat confirmation followed by `userConfirmed: true`.

### Optional local capability roots

The local desktop capability layer can receive additional roots through the
semicolon-separated environment variable LNWJUD_CAPABILITY_ROOTS:

```powershell
$env:LNWJUD_CAPABILITY_ROOTS = 'E:/work;E:/projects'
```

In the default unrestricted mode, all fixed-drive roots are available to local
capability tools. `LNWJUD_CAPABILITY_ROOTS` is optional extra configuration;
it is not a visibility ignore list. Core file tools still require a registered
workspace, and stdio defaults to the machine roots when the variable is unset.

### Start the local HTTP connection

In the dashboard:

1. Select a registered workspace.
2. Click Start Connection.
3. Copy the displayed URL, normally http://127.0.0.1:<port>/mcp.
4. Add it to a local Streamable HTTP MCP client.
5. Click Stop Connection when finished.

The endpoint binds to 127.0.0.1, validates origin/host, and uses the same
application services and permission checks as the dashboard. Do not expose the
loopback URL through a generic port forward.

If dom_cdp is available, the dashboard can launch managed Chrome. Browser
automation remains loopback-bound and separate from the file guard.

## Connect a local Codex client

Local Codex clients can use stdio directly; they do not need Secure MCP Tunnel.
Point the entry at the stdio-capable installed executable:

```powershell
codex mcp add lnwjud -- "$env:LOCALAPPDATA\Programs\lnwjud\lnwjud-mcp-stdio.cmd" --workspace E:\lnwjud
codex mcp list
```

The stdio launcher is the Node-based `lnwjud-mcp-stdio.cmd` shipped next to the
desktop app (not the GUI `lnwjud.exe`). It exposes the full tool catalog,
including skills/MCP bridge meta-tools. Requires Node.js 24+.

The same server can be added in ChatGPT desktop or an IDE extension under
Settings → MCP servers → Add server → STDIO. Restart the host after saving.
In Codex, /mcp lists active servers.

Example user-scoped or trusted project-scoped config.toml:

```toml
[mcp_servers.lnwjud]
command = "C:/Users/<WindowsUser>/AppData/Local/Programs/lnwjud/lnwjud-mcp-stdio.cmd"
args = ["--workspace", "E:/lnwjud"]
startup_timeout_sec = 20
tool_timeout_sec = 3600
```

Use prompt approval while testing an unfamiliar workspace. No OpenAI API key
belongs in this local MCP entry.

## Create an OpenAI Secure MCP Tunnel

This is the path that lets ChatGPT web, which cannot read local files or local
Codex configuration, call lnwjud.

### 1. Create or select a Platform tunnel

Open [OpenAI Platform tunnel settings](https://platform.openai.com/settings/organization/tunnels).
Create a tunnel and record its ID, for example:

```text
tunnel_0123456789abcdef0123456789abcdef
```

Associate the tunnel with the Platform organization that owns it, the target
ChatGPT workspace, and any other Platform organization that will call it. The
same tunnel_id is used by every association.

### 2. Create the correct runtime key

Open [OpenAI Platform API keys](https://platform.openai.com/settings/organization/api-keys).
Create a runtime API key for tunnel-client and grant Tunnels Read + Use.

Do not use an Admin API key or an unrelated project key (sk-proj-...). Keep the
key in a local secret store or environment variable. Never put it in this
repository, a YAML profile, a committed .env file, or a public issue/log. If a
key is exposed, revoke it and create a replacement.

### 3. Download tunnel-client

Use the Platform download link or the [official tunnel-client
releases](https://github.com/openai/tunnel-client). Keep the executable at a
stable path, for example:

```text
C:/Users/<WindowsUser>/Downloads/tunnel/tunnel-client.exe
```

Verify it:

```powershell
$tc = 'C:/Users/<WindowsUser>/Downloads/tunnel/tunnel-client.exe'
& $tc --version
& $tc help quickstart
```

### 4. Create a stdio profile

Set the runtime key only in the current PowerShell process and create the
profile:

```powershell
$env:CONTROL_PLANE_API_KEY = '<runtime-key-for-this-session>'

& $tc init --sample sample_mcp_stdio_local --profile lnwjud --tunnel-id 'tunnel_0123456789abcdef0123456789abcdef' --mcp-command 'C:/Users/<WindowsUser>/AppData/Local/Programs/lnwjud/lnwjud-mcp-stdio.cmd'
```

Use forward slashes in the Windows executable path inside the profile.
Backslashes can be interpreted as YAML escapes and turn C:\Users\... into
C:Users....

The generated profile is normally:

```text
C:/Users/<WindowsUser>/AppData/Roaming/tunnel-client/lnwjud.yaml
```

A minimal profile has this shape. The key remains an environment reference:

```yaml
config_version: 1
control_plane:
  base_url: "https://api.openai.com"
  tunnel_id: "tunnel_0123456789abcdef0123456789abcdef"
  api_key: "env:CONTROL_PLANE_API_KEY"
health:
  listen_addr: "127.0.0.1:0"
admin_ui:
  open_browser: false
log:
  level: info
  format: json
mcp:
  # Force a long ceiling via flag/env/YAML (default is only 10m):
  #   --mcp.connection-max-ttl 168h0m0s
  #   MCP_CONNECTION_MAX_TTL=168h0m0s
  #   mcp.connection_max_ttl: 168h0m0s  (snake_case; hyphenated YAML key is rejected)
  connection_max_ttl: 168h0m0s
  commands:
    - channel: main
      command: "C:/Users/<WindowsUser>/AppData/Local/Programs/lnwjud/lnwjud-mcp-stdio.cmd"
```

### 5. Run diagnostics and the tunnel

Prefer the desktop Control Center: save the Runtime API key once under Settings,
then click Start Tunnel. The key is stored with Windows DPAPI.

Manual session (still supported):

```powershell
$env:CONTROL_PLANE_API_KEY = '<runtime-key-for-this-session>'
$env:MCP_CONNECTION_MAX_TTL = '168h0m0s'
& $tc doctor --profile lnwjud --explain
if ($LASTEXITCODE -ne 0) { throw 'tunnel-client doctor failed' }
& $tc run --profile lnwjud --mcp.connection-max-ttl 168h0m0s
```

Keep this process and the child `lnwjud-mcp-stdio.cmd` process alive while
ChatGPT is using the connector. Use the same LNWJUD_DATA_PATH as the desktop
app so Work Log entries appear in the Control Center.

### 6. Verify the command locally

```powershell
$lnwjud = 'C:/Users/<WindowsUser>/AppData/Local/Programs/lnwjud/lnwjud-mcp-stdio.cmd'
Test-Path $lnwjud
Test-Path $tc
```

If doctor reports a missing executable, fix the YAML path. If launching the
command opens the dashboard instead of holding a stdio MCP process, install a
stdio-capable package. Do not solve that error with shell: true or an
unrestricted PowerShell command string.

## Start the tunnel automatically at Windows logon

A scheduled task is more reliable than leaving a terminal open. This example
stores the runtime key encrypted with the current Windows user's DPAPI; the key
is not written in plain text to the profile or task command line.

### Save the key once

```powershell
$secretDir = Join-Path $env:APPDATA 'tunnel-client'
New-Item -ItemType Directory -Path $secretDir -Force | Out-Null
$secureKey = Read-Host 'Tunnel runtime API key' -AsSecureString
$secureKey | ConvertFrom-SecureString | Set-Content (Join-Path $secretDir 'lnwjud.runtime.secret')
```

The encrypted value is tied to the same Windows user and machine.

### Create a runner script

Save as start-lnwjud-tunnel.ps1:

```powershell
$ErrorActionPreference = 'Stop'
$tc = 'C:/Users/<WindowsUser>/Downloads/tunnel/tunnel-client.exe'
$profile = 'lnwjud'
$secretPath = Join-Path $env:APPDATA 'tunnel-client/lnwjud.runtime.secret'

if (-not (Test-Path $tc)) { throw "Missing tunnel-client: $tc" }
if (-not (Test-Path $secretPath)) { throw "Missing encrypted runtime key: $secretPath" }

$encrypted = Get-Content $secretPath -Raw
$secureKey = ConvertTo-SecureString $encrypted
$keyPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureKey)
try {
  $env:CONTROL_PLANE_API_KEY = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($keyPointer)
  & $tc doctor --profile $profile --explain
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  & $tc run --profile $profile
  exit $LASTEXITCODE
}
finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($keyPointer)
  Remove-Item Env:CONTROL_PLANE_API_KEY -ErrorAction SilentlyContinue
}
```

### Register the logon task

Run once as the same Windows user who saved the DPAPI secret:

```powershell
$runner = 'C:/Users/<WindowsUser>/Downloads/tunnel/start-lnwjud-tunnel.ps1'
$userId = "$env:USERDOMAIN/$env:USERNAME"
$argument = '-NoProfile -ExecutionPolicy Bypass -File "' + $runner + '"'
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $argument
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $userId
$principal = New-ScheduledTaskPrincipal -UserId $userId -LogonType InteractiveToken -RunLevel Limited
Register-ScheduledTask -TaskName 'lnwjud Secure MCP Tunnel' -Action $action -Trigger $trigger -Principal $principal -Force
```

Check or start it:

```powershell
Get-ScheduledTask -TaskName 'lnwjud Secure MCP Tunnel'
Start-ScheduledTask -TaskName 'lnwjud Secure MCP Tunnel'
```

Use Run only when user is logged on and a limited principal unless your
organization has a documented service-account design. lnwjud does not need an
administrator token for normal workspace operations.

## Add the connector in ChatGPT Developer mode

### Enable Developer mode

In ChatGPT web:

1. Open Settings.
2. Select Security and login.
3. Turn on Developer mode.

Enterprise/Edu administrators may need to enable this before it appears.

### Create the developer app

1. Open [ChatGPT Plugins](https://chatgpt.com/plugins).
2. Select the plus (+) button.
3. Enter a name such as lnwjud and a short description such as
   Local Windows development workspace gateway.
4. Under Connection, choose Tunnel.
5. Select the tunnel or enter its tunnel_id.
6. Create the connection and review the discovered tools and schemas.

lnwjud does not expose an OAuth login endpoint. Do not invent OAuth URLs or
paste the runtime key into the ChatGPT connector form. Tunnel authentication is
handled by tunnel-client; ChatGPT selects the OpenAI-hosted tunnel. Choose a
no-extra-auth option only when the tunnel form offers it.

### Attach it to a new chat

Start a new conversation, open the tools menu, and add the lnwjud connection.
A good smoke test is:

```text
Use lnwjud to inspect the available workspace and report only registered workspace IDs and display names. Do not read file contents yet.
```

Then test a read-only project flow:

```text
For workspace <workspace-id>, show the project snapshot, Git status, and the top-level workspace tree. Do not modify anything.
```

After changing tool metadata or restarting the tunnel, refresh the connector and
start a new chat.

## Complete MCP tool catalog

The current v3.0.0 catalog contains 184 tools across workspace/project
primitives, paging and indexing, compound/parallel workflows, Git/test/cache
surfaces, lifecycle and permission contracts, local Windows capabilities,
skills/MCP bridge discovery, visual adapters, and recovery/session tools.

### Workspace and project inspection

| Tool | Permission | What it does |
| --- | --- | --- |
| workspace_info | READ | Returns display name, canonical root, project profile, and Git summary |
| workspace_tree | READ | Returns a bounded directory tree; hidden and heavy folders are included, with depth/entry bounds and truncation metadata |
| project_snapshot | READ | Returns profile, Git counts, top-level tree, managed processes, and recent error summaries without source contents |

### Optional machine-root discovery extension

By default, stdio and desktop runtimes register drive **E:** (`E:\`) as the
sole machine root and prune other drive roots on startup. In **Unrestricted
mode**, every fixed drive (C:, D:, E:, …) is registered instead and nothing is
pruned. Project folders may be registered under those roots via MCP or the
desktop UI.

| Tool | Permission | Input | What it does |
| --- | --- | --- | --- |
| workspace_list | READ | Empty object | Lists registered machine roots and project workspaces (`kind`: `machine_root` or `project`) |
| workspace_register | WRITE | parentWorkspaceId, path, optional displayName | Registers an existing project directory below a machine root (idempotent; any drive root in unrestricted mode) |

The extension still validates the parent ID, canonical path, and reparse points.
**Secret and hidden files are intentionally readable in the default unrestricted
mode** (including `.env`, keys, and credentials) on every fixed drive. Image and
other binary files are returned as base64 with no application size cap. Paths
outside registered roots remain denied only when unrestricted mode is explicitly
disabled.

Local capability tools (`shell`, `vision`, `accessibility`, `input_event`,
`window`, `dom_cdp`, `health`) are available on both desktop HTTP MCP and
stdio/tunnel. Shell allowed roots include `E:\`.

If your build does not advertise `workspace_register`, register the workspace
from the desktop dashboard and use its workspace ID.

### Files and search

| Tool | Permission | What it does |
| --- | --- | --- |
| read_file | READ | Reads a workspace file as UTF-8 or an image/binary payload. Absolute paths do not require workspaceId. |
| read_files | READ | Reads up to 20 workspace files. Absolute paths do not require workspaceId. |
| search_files | READ | Searches workspace filenames with bounded results; automatic mode skips vendor/build/binary/generated paths |
| search_text | READ | Searches text through direct ripgrep arguments; automatic mode avoids binary/generated context |
| write_file | WRITE | Writes UTF-8 text, creates missing parents, and checkpoints an existing target before overwrite |
| apply_patch | WRITE | Validates and applies bounded file changes, creating missing parents |
| move_file | WRITE | Moves a file or directory within one workspace, creating missing destination parents |
| copy_file | WRITE | Copies a file or directory within one workspace, creating missing destination parents |
| delete_file | DANGEROUS | Deletes one file or an empty directory after the user confirms in chat (`userConfirmed: true`) |

In the default unrestricted mode, `.env`, `.env.*`, `*.pem`, `*.key`, `id_rsa*`,
`id_ed25519*`, `.ssh/**`, `.aws/**`, and `credentials.json` are readable on
every fixed drive. Explicitly setting unrestricted mode to false restores the
restricted-drive secret policy.

### Git

| Tool | Permission | What it does |
| --- | --- | --- |
| git | EXECUTE | Runs git subcommands; destructive forms require explicit chat confirmation plus `userConfirmed: true` |
| git_status | READ | Parsed read-only working-tree status |
| git_diff | READ | Bounded read-only diff with truncation metadata |
| git_log | READ | Bounded structured commit history |

Use `git` for init, add, commit, remote, push, pull, rm, clean, reset, and
branch deletes. `git_status` / `git_diff` / `git_log` remain structured
read-only views. Destructive Git forms such as `rm`, `clean`, `reset`, forced branch/tag moves, stash removal, force-push, and working-tree discard require explicit confirmation before execution.

### Processes and project commands

| Tool | Permission | What it does |
| --- | --- | --- |
| process_start | EXECUTE | Starts one policy-checked executable; destructive command forms require explicit confirmation |
| process_status | READ | Reads state for an owned process handle |
| process_logs | READ | Reads bounded stdout/stderr records with sequence numbers |
| process_stop | EXECUTE | Stops an owned managed process tree |
| project_dev | EXECUTE | Runs the detected project development command |
| project_test | EXECUTE | Runs the detected project test command |
| project_lint | EXECUTE | Runs the detected project lint command |
| project_typecheck | EXECUTE | Runs the detected project type-check command |
| project_build | EXECUTE | Runs the detected project build command |

process_start uses an executable plus an args array with shell false. It is not
PowerShell, CMD, or a free-form shell parser. Project commands come from the
detected ProjectProfile.

### Context Economy Engine

Automatic discovery is optimized for useful context rather than raw tree size.
The default policy skips `node_modules`, `.git`, `dist`, `build`, `coverage`,
`.next`, `.turbo`, `.cache`, `vendor`, `target`, `bin`, `obj`, virtualenvs,
binary files, bundles, and source maps. Lockfiles and large JSON/log/CSV files
start as metadata summaries; source and tests start with relevant symbol/line
ranges; changed Git files are ranked first.

This policy is not a deny list. Explicit reads remain full-access within the
normal workspace boundary, for example:

```text
read_file({ "path": "node_modules/pkg/index.js" })
read_many_files({ "files": [{ "path": ".env" }, { "path": ".git/config" }] })
search_files({ "includeIgnored": true, "path": "node_modules/pkg" })
workspace_context({ "includeIgnored": true, "query": "login" })
```

The Context Ledger keeps bounded in-memory fingerprints and small previous
contents. Repeated delivery can be represented as `unchanged`, a line `diff`,
or a duplicate `referencePath`; unchanged bytes are not sent again. The
`context_economy_stats` tool and `telemetry_dashboard` expose raw discovered
bytes, delivered bytes, duplicate/previously-seen bytes avoided, skipped paths,
ledger hits, and estimated savings. No raw file content or credential is
persisted by this telemetry.

### Local Codex delegation

| Tool | Permission | What it does |
| --- | --- | --- |
| codex_status | READ | Reports local Codex installation/version/capabilities without credential inspection |
| codex_run | EXECUTE | Delegates an instruction to local Codex and returns codexTaskId |
| codex_task_status | READ | Reads state for an owned Codex task |
| codex_task_logs | READ | Reads bounded logs for an owned Codex task |
| codex_stop | EXECUTE | Stops only a Codex task launched by lnwjud |

Typical flow: codex_run → poll task status/logs → inspect git_diff → run checks.

### Local desktop capabilities

| Tool | Permission | Actions |
| --- | --- | --- |
| shell | EXECUTE | Direct executable invocation; foreground/background tasks, status, wait, logs, result, cancel, resume, approvals, timeouts, dry-run, and bounded output |
| dom_cdp | DANGEROUS | Managed Chrome launch/status/tabs/navigation/JavaScript/DOM query/click/type/wait/screenshot |
| accessibility | DANGEROUS | Windows UI Automation for app/window discovery, element inspection, focus, values, clicks, selections, and menus |
| input_event | DANGEROUS | Text, paste, keys/hotkeys, pointer movement, clicks, drag, scroll, button state, release-all, and sequences |
| vision | READ | Local display/region/window PNG capture and optional OCR; never clicks or types |
| window | DANGEROUS | Native window list/inspect/activate/close/minimize/maximize/restore/move/resize/frame operations |
| health | READ | Per-backend diagnostics with no input/browser/window side effects |
| system_info | READ | OS/CPU/memory/disks/battery/uptime and top processes (read-only) |
| notification | EXECUTE | Windows toast (BurntToast) or balloon notification |
| file_dialog | EXECUTE | Native open/save dialogs returning chosen paths; does not read or write files itself |
| clipboard | DANGEROUS | Clipboard text read/write and PNG image read as base64 |
| web_fetch | DANGEROUS | Bounded http/https GET/POST/PUT/DELETE/HEAD with text or base64 responses |
| audio | DANGEROUS | Microphone WAV recording (up to 600s), local audio playback, stop |
| screen_record | DANGEROUS | ffmpeg gdigrab screen recording with start/stop/status (requires ffmpeg on PATH) |
| office | DANGEROUS | Excel range read/write/save_as and Word read_text/replace/save_as via COM (requires Office) |
| scheduler | DANGEROUS | Windows scheduled task list/create/run; delete requires userConfirmed after a chat confirmation |

Use dom_cdp for web pages, accessibility for semantic native controls, and
input_event only as a low-level fallback. shell remains direct executable
invocation, not an unrestricted PowerShell or CMD gateway.

### Skills and local MCP bridge

These meta-tools discover local agent skills and other MCP servers on the
machine (Cursor `mcp.json`, Claude Desktop config, plus lnwjud settings). They
do not flatten every child tool into the lnwjud catalog. Default mode enables
all discovered servers except lnwjud itself (recursion guard).

| Tool | Permission | What it does |
| --- | --- | --- |
| skills_list | DANGEROUS | Lists discovered skills from Cursor/Claude/Agents/workspace roots |
| skills_read | DANGEROUS | Reads a skill `SKILL.md` or a relative file inside that skill folder |
| mcp_list | DANGEROUS | Lists discovered local MCP servers and enabled/connected state |
| mcp_describe | DANGEROUS | Connects if needed and returns child tool names/schemas |
| mcp_call | DANGEROUS | Forwards a tool call to a child MCP server |

**Security note:** These tools are available on every transport, including the
Secure MCP Tunnel. Packaged stdio and Secure Tunnel connections intentionally
use the full permission profile, so a remote ChatGPT session can invoke local
desktop/browser MCP servers if lnwjud and the tunnel are running. Desktop MCP
still applies the profile selected in Settings. Disable individual servers
through the lnwjud `extensions` settings JSON (`disabledServers`) when needed.

Settings key `extensions` (SQLite) example:

```json
{
  "mode": "enable_all",
  "disabledServers": [],
  "disabledSkillRoots": [],
  "extraSkillRoots": [],
  "extraMcpServers": {}
}
```

The exact schemas and defaults are maintained in
`packages/mcp-server/src/tools/schemas.ts`.

## Recommended workflows

### Read, change, verify

1. workspace_info: confirm the workspace ID.
2. project_snapshot and git_status: establish the starting state.
3. search_files/search_text/read_file: locate code.
4. apply_patch: make a coherent edit.
5. project_test/project_lint/project_typecheck/project_build.
6. process_status/process_logs for long-running work.
7. git_diff and git_status for the final review.

### Run a development server

Use project_dev for a detected project command. For a manually approved
executable, use process_start with separate arguments and a workspace-relative
cwd. Save the returned process ID and use process_status, process_logs, and
process_stop.

### Delegate to Codex

Run codex_status first. If available, use codex_run, poll the returned task ID,
inspect the logs, and review git_diff yourself. In unrestricted mode Codex can
read the full registered workspace, including `.env`; keep credentials out of
logs, commits, and prompts when they are not needed.

### Automate Windows applications

Use health for diagnostics; dom_cdp for managed web pages; accessibility for
native controls; vision for screen/OCR fallback; input_event only when the
higher-level APIs cannot operate; and window for native window management.

## Unrestricted full-access mode

Unrestricted mode lifts the workspace/command limits while keeping the
deletion blocks. Enable it either way:

- Settings → Unrestricted mode (checkbox; restart the app to apply), or
- `$env:LNWJUD_UNRESTRICTED = '1'` before launching lnwjud (the tunnel script
  below sets this automatically for the stdio runtime).

When enabled:

- Every fixed drive (C:, D:, E:, …) is registered as a machine root, so
  `PATH_OUTSIDE_WORKSPACE` stops appearing and `workspace_register` accepts any drive.
- `cmd.exe`, `powershell.exe`, `pwsh`, `bash`, and `sh` are allowed through
  `process_start` (still spawned with separate arguments, `shell: false`).
- `.cmd`/`.bat` shims (npm.cmd, npx.cmd, …) accept arguments containing `& | < > ^ %`.
- Secret files (.env, *.key, id_rsa, .ssh/**, .aws/**, credentials.json) are
  readable on every drive; binary files read as base64 with no size cap.
- Shell working directories may be anywhere and the full environment is passed
  through to child processes.

Still confirmation-gated in every mode: filesystem `del`/`erase`/`rm`/`rmdir`/`rd`/
`unlink`/`remove-item`, `delete_file`, destructive Git (`rm`, `clean`, `reset`, force/discard forms), HTTP DELETE, mutating Office actions, child MCP/agent mutation boundaries, and opaque UI actions that may cause data loss. These operations require explicit chat confirmation followed by `userConfirmed: true`.

## Real-time Live Logs

The desktop app includes a Live Logs screen (sidebar) with three tabs:

- Tunnel — tails `%APPDATA%\tunnel-client\lnwjud-tunnel.log` continuously
- MCP activity — every tool call received by MCP appears immediately
- Processes — state and recent output of managed processes

Follow/pause, text filter, clear, and export-to-file are available per tab,
and "Pop out viewer" opens a compact separate window. The viewer can also be
launched directly:

```powershell
& "$env:LOCALAPPDATA\Programs\lnwjud\lnwjud.exe" --log-viewer
```

The app is single-instance: launching with `--log-viewer` while the dashboard
is already open focuses/opens the viewer in the running instance.

Live Logs v2 preserves partial lines across tunnel-client chunks, correlates
MCP activity, and keeps the tunnel/process streams visible while the app is
running. It is covered by the desktop log-hub and tunnel lifecycle tests.

## Tunnel state sync between the script and the app

The tunnel can be started from the PowerShell script or from the app's Start
Tunnel button, and both reflect the same state:

- When the script starts the tunnel, the dashboard detects the external
  tunnel-client process (within ~4 seconds) and shows "Tunnel connected
  (from script)" with the Start button disabled.
- Stop Tunnel in the app also stops a script-started tunnel.
- If the tunnel exits, the status returns to stopped automatically.

## Run the tunnel with a resilient script

The repository ships `scripts/start-lnwjud-tunnel.ps1`. Copy it anywhere and
run it instead of a manual `tunnel-client run`:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "C:\Users\<WindowsUser>\Downloads\tunnel\start-lnwjud-tunnel.ps1"
```

The script sets `--mcp.connection-max-ttl 168h0m0s` (prevents the 10-minute
disconnect), writes `lnwjud-tunnel.log`, aligns `LNWJUD_DATA_PATH` with the
desktop app so ChatGPT activity shows in the Work Log and Live Logs, enables
unrestricted mode, restarts the tunnel automatically when it drops (including
TTL shutdowns that exit 0), avoids double-starting, and opens the log viewer
window. Rapid failures are bounded with backoff; after five failures in a
30-second window it stops retrying and asks for a manual Start Tunnel. Parameters:
`-NoViewer`, `-OpenDashboard`, `-ForceRestart`, `-Once`.

## Security and operational model

### Transport

The local HTTP MCP endpoint binds to 127.0.0.1. Stdio is a child-process
transport. Secure MCP Tunnel is an outbound HTTPS bridge, not an inbound public
listener.

### Filesystem

Every client path passes the workspace path guard. It resolves relative paths,
rejects NUL bytes/traversal, handles non-existing write targets through their
nearest existing ancestor, rejects junction/symlink/reparse-point escapes, and
applies the secret policy after canonicalization.

### Process execution

The default process API is equivalent to:

```text
spawn(executable, args, { shell: false })
```

Arguments are not concatenated into a shell command. Processes have owned
handles, bounded logs, timeout/cancel support, and Windows process-tree
termination. Normal execution is as the current user; administrator privilege
requests are denied by the capability backend.

### Audit and recovery

Audit records contain timestamp, actor/client, tool/action, workspace ID,
sanitized argument summary, permission decision, result code, and duration.
They do not persist full prompts, environment variables, bearer tokens, API
keys, passwords, or unlimited terminal history. Existing-file writes checkpoint
before overwrite where supported.

### Explicitly unavailable tools

These are intentionally not in the core catalog:

```text
run_shell
git_reset
git_clean
kill_pid
read_arbitrary_path
```

`powershell` and `cmd` are not standalone tools. They are executable names:
`process_start`/`shell` allow them in unrestricted mode (the default) and deny
them otherwise; filesystem deletion-style invocations require confirmation.
Git itself is invoked with the `git` tool or `shell` + `git.exe`, not as
standalone `git_reset` / `git_clean` tools.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| mcp-command preflight shows C:Users... | Use forward slashes in the YAML command path |
| profile_load says the YAML file is missing | Run init with profile lnwjud and verify %APPDATA%/tunnel-client/lnwjud.yaml |
| doctor rejects the key | Use a runtime key with Tunnels Read + Use; do not substitute an Admin or unrelated project key |
| Tunnel is not listed in ChatGPT | Associate it with the target ChatGPT workspace and verify Tunnels Read + Use |
| ChatGPT reports no tools | Check doctor, the local stdio command, tunnel health, connector refresh, and a new chat |
| The desktop window opens when the tunnel starts | A GUI-only executable was configured; install/use the stdio launcher |
| WORKSPACE_NOT_FOUND | Use the exact registered workspace ID, not a path or display name |
| PATH_OUTSIDE_WORKSPACE | Register/select the correct root and use a workspace-relative path |
| A secret file is denied | Check that unrestricted mode was not explicitly disabled (`LNWJUD_UNRESTRICTED=0` or Settings) and that the root is registered |
| process_start refuses PowerShell/CMD | Shell hosts are denied in default mode; enable Unrestricted mode to allow cmd/powershell/pwsh (deletion commands stay blocked) |
| Child process windows are visible | This is expected for the current visible-window Windows build; use handles/logs to manage them |
| codex_status is unavailable | Install Codex or continue with process_* and project_*; lnwjud does not inspect credentials |
| Tunnel disconnects with context canceled / context deadline exceeded | MCP connection TTL teardown; start-lnwjud-tunnel.ps1 restarts even on exit 0. After restart, Refresh the connector or send a new ChatGPT message |
| ChatGPT advertises old tools | Restart server/tunnel, Refresh the connector, and start a new conversation |
| Long tool run looks dead / silent | lnwjud emits progress heartbeats every ~15s after the first 15s; ensure tunnel-client is current and TTL is set via `--mcp.connection-max-ttl 168h0m0s` |

For ambiguous failures, call health locally and run tunnel-client doctor
--explain before restarting both layers.

## Development and verification

```powershell
corepack pnpm@10.15.0 lint
corepack pnpm@10.15.0 typecheck
corepack pnpm@10.15.0 test
corepack pnpm@10.15.0 test:integration
corepack pnpm@10.15.0 test:packaging
corepack pnpm@10.15.0 build
corepack pnpm@10.15.0 package:windows
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\verify-release.ps1
```

Electron end-to-end tests:

```powershell
corepack pnpm@10.15.0 test:e2e
```

Use git diff --check before committing.

## Repository layout

```text
apps/desktop/          Electron main/preload/renderer and dashboard
apps/cli/              CLI parser and local service entrypoints
packages/application/  Shared use cases and orchestration
packages/domain/       Result/error contracts and policy types
packages/workspace/    Workspace registry, path guard, and secret policy
packages/filesystem/   File adapters
packages/search/       Ripgrep adapter
packages/project/      Project detection and command profiles
packages/git/          Read-only Git adapter
packages/process/      Process lifecycle and bounded logs
packages/codex/        Local Codex discovery and task adapter
packages/permissions/  Permission profiles and command policy
packages/audit/        Sanitized audit events
packages/storage/      SQLite repositories and migrations
packages/mcp-server/   MCP registry plus stdio/HTTP transports
packages/capabilities/ Local shell/browser/UI/vision/window capabilities
packages/extensions/   Local skills catalog and MCP server bridge
packages/ipc-contracts/Typed Electron IPC contracts
assets/logo/           Official brand logos and icons in multiple resolutions
```

All entrypoints are intended to call the same application services so that
validation and permissions remain consistent.

## Further reading

### Official OpenAI documentation

- [Secure MCP Tunnel](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels)
- [Connect and test a plugin in ChatGPT](https://developers.openai.com/plugins/deploy/connect-chatgpt)
- [ChatGPT MCP and Codex configuration](https://learn.chatgpt.com/docs/extend/mcp)
- [OpenAI Platform tunnel settings](https://platform.openai.com/settings/organization/tunnels)
- [OpenAI Platform API keys](https://platform.openai.com/settings/organization/api-keys)
- [OpenAI tunnel-client releases](https://github.com/openai/tunnel-client)

## License

This project is licensed under the [MIT License](LICENSE).
