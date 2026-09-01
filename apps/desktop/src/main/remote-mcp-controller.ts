import { spawn, type ChildProcess } from 'node:child_process';
import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { RemoteMcpStatus } from '@lnwjud/ipc-contracts';
import { protectTunnelSecret, unprotectTunnelSecret } from './tunnel-secret-dpapi.js';

interface RegisteredClient {
  readonly clientId: string;
  readonly redirectUris: readonly string[];
  readonly clientName: string | null;
}

interface AuthorizationCode {
  readonly clientId: string;
  readonly redirectUri: string;
  readonly codeChallenge: string;
  readonly expiresAt: number;
}

interface AccessGrant {
  readonly clientId: string;
  readonly expiresAt: number;
}

export interface RemoteMcpControllerOptions {
  readonly dataPath: string;
  readonly getLocalMcpUrl: () => Promise<string | null>;
  readonly now?: () => number;
}

const NGROK_API = 'http://127.0.0.1:4041/api/tunnels';
const PAIRING_TTL_MS = 15 * 60_000;
const CODE_TTL_MS = 5 * 60_000;
const ACCESS_TTL_MS = 8 * 60 * 60_000;
const REFRESH_TTL_MS = 30 * 24 * 60 * 60_000;

export class RemoteMcpController {
  private readonly dataPath: string;
  private readonly getLocalMcpUrl: () => Promise<string | null>;
  private readonly now: () => number;
  private gateway: Server | null = null;
  private gatewayUrl: string | null = null;
  private publicOrigin: string | null = null;
  private ngrok: ChildProcess | null = null;
  private ngrokPath: string | null = null;
  private ngrokProbeAt = 0;
  private runState: RemoteMcpStatus['state'] = 'stopped';
  private message: string | null = null;
  private pairingCode: string | null = null;
  private pairingExpiresAt = 0;
  private pairingFailures = 0;
  private readonly clients = new Map<string, RegisteredClient>();
  private readonly authCodes = new Map<string, AuthorizationCode>();
  private readonly accessTokens = new Map<string, AccessGrant>();
  private readonly refreshTokens = new Map<string, AccessGrant>();

  public constructor(options: RemoteMcpControllerOptions) {
    this.dataPath = options.dataPath;
    this.getLocalMcpUrl = options.getLocalMcpUrl;
    this.now = options.now ?? Date.now;
  }

  public async status(): Promise<RemoteMcpStatus> {
    const localMcpUrl = await this.getLocalMcpUrl().catch(() => null);
    const probeNow = this.now();
    if (this.ngrokProbeAt === 0 || probeNow - this.ngrokProbeAt >= 30_000) {
      this.ngrokPath = await resolveNgrokExecutable();
      this.ngrokProbeAt = probeNow;
    }
    const executable = this.ngrokPath;
    const hasAuthtoken = existsSync(this.secretPath());
    if (this.pairingCode !== null && this.now() >= this.pairingExpiresAt) {
      this.pairingCode = null;
      this.pairingExpiresAt = 0;
    }
    return {
      state: this.runState,
      provider: 'ngrok',
      installed: executable !== null,
      hasAuthtoken,
      ngrokPath: executable,
      localMcpUrl,
      localGatewayUrl: this.gatewayUrl,
      publicMcpUrl: this.publicOrigin === null ? null : `${this.publicOrigin}/mcp`,
      pairingCode: this.runState === 'running' ? this.pairingCode : null,
      pairingCodeExpiresAt: this.runState === 'running' && this.pairingExpiresAt > 0 ? new Date(this.pairingExpiresAt).toISOString() : null,
      oauthProtected: true,
      message: this.message,
    };
  }

  public async installProvider(): Promise<RemoteMcpStatus> {
    const existing = await resolveNgrokExecutable();
    if (existing !== null) {
      this.ngrokPath = existing;
      this.message = 'ngrok is already installed';
      return this.status();
    }
    if (process.platform !== 'win32') throw new Error('Automatic ngrok installation is currently available on Windows only');
    this.runState = 'installing';
    this.message = 'Installing ngrok from Microsoft Store via WinGet…';
    try {
      await runCommand('winget.exe', ['install', 'ngrok', '-s', 'msstore', '--accept-package-agreements', '--accept-source-agreements', '--silent'], 180_000);
      const installed = await resolveNgrokExecutable();
      if (installed === null) throw new Error('ngrok installation completed but ngrok.exe could not be resolved. Sign out/in or restart Windows if App Execution Aliases were just installed.');
      this.ngrokPath = installed;
      this.runState = 'stopped';
      this.message = 'ngrok installed from the official Microsoft Store package';
      return this.status();
    } catch (error) {
      this.runState = 'error';
      this.message = errorMessage(error);
      throw error;
    }
  }

  public async saveAuthtoken(raw: string): Promise<RemoteMcpStatus> {
    const token = raw.trim();
    if (token.length < 16 || /\s/.test(token)) throw new Error('Enter a valid ngrok authtoken');
    await mkdir(this.secretDir(), { recursive: true });
    const encrypted = await protectTunnelSecret(token);
    await writeFile(this.secretPath(), encrypted, { encoding: 'utf8', mode: 0o600 });
    this.message = 'ngrok authtoken saved securely with Windows DPAPI';
    return this.status();
  }

  public async regeneratePairingCode(): Promise<RemoteMcpStatus> {
    this.issuePairingCode();
    this.message = 'A new OAuth pairing code was generated';
    return this.status();
  }

  public async start(): Promise<RemoteMcpStatus> {
    if (this.runState === 'running') return this.status();
    this.runState = 'starting';
    this.message = 'Starting protected Remote MCP…';
    try {
      const localMcpUrl = await this.getLocalMcpUrl();
      if (localMcpUrl === null) throw new Error('Local MCP is unavailable. Start the lnwjud MCP listener first.');
      const executable = this.ngrokPath ?? await resolveNgrokExecutable();
      if (executable === null) throw new Error('ngrok is not installed. Use Install ngrok first.');
      this.ngrokPath = executable;
      const authtoken = await this.loadAuthtoken();
      if (authtoken === null) throw new Error('ngrok authtoken is not configured');
      await this.startGateway(localMcpUrl);
      if (this.gatewayUrl === null) throw new Error('Remote MCP gateway did not start');
      this.issuePairingCode();
      this.publicOrigin = null;
      this.ngrok = spawn(executable, ['http', this.gatewayUrl, '--web-addr=127.0.0.1:4041', '--log=stdout', '--log-format=json'], {
        env: { ...process.env, NGROK_AUTHTOKEN: authtoken },
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      this.ngrok.stdout?.on('data', () => undefined);
      this.ngrok.stderr?.on('data', (chunk: Buffer | string) => {
        const text = String(chunk).trim();
        if (text.length > 0) this.message = redactNgrokError(text);
      });
      this.ngrok.once('exit', (code) => {
        if (this.runState === 'stopped') return;
        this.runState = 'error';
        this.message = `ngrok stopped unexpectedly (exit ${code ?? 'unknown'})`;
        this.publicOrigin = null;
        this.ngrok = null;
      });
      const origin = await waitForNgrokPublicOrigin(15_000);
      if (origin === null) throw new Error(this.message ?? 'ngrok started but no public HTTPS endpoint was reported');
      this.publicOrigin = origin;
      this.runState = 'running';
      this.message = 'Remote MCP is online and protected by OAuth + pairing code';
      return this.status();
    } catch (error) {
      await this.stopOwnedRuntime();
      this.runState = 'error';
      this.message = errorMessage(error);
      throw error;
    }
  }

  public async stop(): Promise<RemoteMcpStatus> {
    this.runState = 'stopped';
    this.message = 'Remote MCP stopped';
    await this.stopOwnedRuntime();
    return this.status();
  }

  public async close(): Promise<void> {
    this.runState = 'stopped';
    await this.stopOwnedRuntime();
  }

  private async startGateway(localMcpUrl: string): Promise<void> {
    if (this.gateway !== null) return;
    const server = createServer((request, response) => {
      void this.handleGatewayRequest(request, response, localMcpUrl).catch((error: unknown) => {
        if (!response.headersSent) json(response, 500, { error: 'server_error', error_description: errorMessage(error) });
        else response.end();
      });
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => resolve());
    });
    const address = server.address();
    if (address === null || typeof address === 'string') {
      server.close();
      throw new Error('Remote MCP gateway could not resolve its loopback port');
    }
    this.gateway = server;
    this.gatewayUrl = `http://127.0.0.1:${address.port}`;
  }

  private async handleGatewayRequest(request: IncomingMessage, response: ServerResponse, localMcpUrl: string): Promise<void> {
    const url = new URL(request.url ?? '/', this.publicOrigin ?? this.gatewayUrl ?? 'http://127.0.0.1');
    if (request.method === 'GET' && (url.pathname === '/.well-known/oauth-protected-resource' || url.pathname === '/.well-known/oauth-protected-resource/mcp')) {
      const origin = this.requirePublicOrigin();
      json(response, 200, { resource: `${origin}/mcp`, authorization_servers: [origin], bearer_methods_supported: ['header'] });
      return;
    }
    if (request.method === 'GET' && url.pathname === '/.well-known/oauth-authorization-server') {
      const origin = this.requirePublicOrigin();
      json(response, 200, {
        issuer: origin,
        authorization_endpoint: `${origin}/oauth/authorize`,
        token_endpoint: `${origin}/oauth/token`,
        registration_endpoint: `${origin}/oauth/register`,
        response_types_supported: ['code'],
        grant_types_supported: ['authorization_code', 'refresh_token'],
        token_endpoint_auth_methods_supported: ['none'],
        code_challenge_methods_supported: ['S256'],
      });
      return;
    }
    if (request.method === 'POST' && url.pathname === '/oauth/register') {
      const body = await readJson(request, 64 * 1024);
      const redirectUris = Array.isArray(body.redirect_uris) ? body.redirect_uris.filter((entry): entry is string => typeof entry === 'string' && isSafeRedirectUri(entry)) : [];
      if (redirectUris.length === 0) { json(response, 400, { error: 'invalid_redirect_uri' }); return; }
      const clientId = token(24);
      this.clients.set(clientId, { clientId, redirectUris, clientName: typeof body.client_name === 'string' ? body.client_name.slice(0, 120) : null });
      json(response, 201, { client_id: clientId, redirect_uris: redirectUris, token_endpoint_auth_method: 'none' });
      return;
    }
    if (url.pathname === '/oauth/authorize' && (request.method === 'GET' || request.method === 'POST')) {
      const params = request.method === 'POST' ? new URLSearchParams(await readText(request, 32 * 1024)) : url.searchParams;
      await this.handleAuthorize(params, response);
      return;
    }
    if (request.method === 'POST' && url.pathname === '/oauth/token') {
      await this.handleToken(new URLSearchParams(await readText(request, 32 * 1024)), response);
      return;
    }
    if (url.pathname === '/mcp') {
      const bearer = parseBearer(request.headers.authorization);
      if (bearer === null || !this.validAccessToken(bearer)) {
        const origin = this.requirePublicOrigin();
        response.statusCode = 401;
        response.setHeader('WWW-Authenticate', `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp"`);
        response.end('Unauthorized');
        return;
      }
      await proxyMcp(request, response, localMcpUrl);
      return;
    }
    if (request.method === 'GET' && url.pathname === '/') {
      html(response, 200, '<h1>lnwjud Remote MCP</h1><p>OAuth-protected MCP endpoint is online.</p>');
      return;
    }
    response.statusCode = 404;
    response.end('Not found');
  }

  private async handleAuthorize(params: URLSearchParams, response: ServerResponse): Promise<void> {
    const clientId = params.get('client_id') ?? '';
    const redirectUri = params.get('redirect_uri') ?? '';
    const state = params.get('state') ?? '';
    const challenge = params.get('code_challenge') ?? '';
    const method = params.get('code_challenge_method') ?? '';
    const client = this.clients.get(clientId);
    if (params.get('response_type') !== 'code' || client === undefined || !client.redirectUris.includes(redirectUri) || challenge.length < 32 || method !== 'S256') {
      json(response, 400, { error: 'invalid_request' });
      return;
    }
    const submitted = params.get('pairing_code');
    if (submitted === null) {
      const escaped = escapeHtml;
      html(response, 200, `<!doctype html><html><head><meta name="viewport" content="width=device-width"><title>Authorize lnwjud</title></head><body style="font-family:system-ui;max-width:560px;margin:48px auto;padding:0 20px"><h1>Authorize ChatGPT</h1><p>Enter the 6-digit pairing code shown in lnwjud Desktop. This prevents anyone who discovers your ngrok URL from authorizing themselves.</p><form method="post"><input type="hidden" name="response_type" value="code"><input type="hidden" name="client_id" value="${escaped(clientId)}"><input type="hidden" name="redirect_uri" value="${escaped(redirectUri)}"><input type="hidden" name="state" value="${escaped(state)}"><input type="hidden" name="code_challenge" value="${escaped(challenge)}"><input type="hidden" name="code_challenge_method" value="S256"><label>Pairing code<br><input autofocus inputmode="numeric" pattern="[0-9]{6}" name="pairing_code" required style="font-size:24px;letter-spacing:6px;padding:10px"></label><p><button type="submit" style="font-size:16px;padding:10px 18px">Authorize</button></p></form></body></html>`);
      return;
    }
    if (!this.verifyPairingCode(submitted)) {
      html(response, 403, '<h1>Pairing code rejected</h1><p>Generate a new code in lnwjud Desktop and try again.</p>');
      return;
    }
    const code = token(32);
    this.authCodes.set(code, { clientId, redirectUri, codeChallenge: challenge, expiresAt: this.now() + CODE_TTL_MS });
    this.pairingCode = null;
    this.pairingExpiresAt = 0;
    const destination = new URL(redirectUri);
    destination.searchParams.set('code', code);
    if (state.length > 0) destination.searchParams.set('state', state);
    response.statusCode = 302;
    response.setHeader('Location', destination.toString());
    response.end();
  }

  private async handleToken(params: URLSearchParams, response: ServerResponse): Promise<void> {
    const grantType = params.get('grant_type');
    const clientId = params.get('client_id') ?? '';
    if (grantType === 'authorization_code') {
      const code = params.get('code') ?? '';
      const grant = this.authCodes.get(code);
      this.authCodes.delete(code);
      const verifier = params.get('code_verifier') ?? '';
      if (grant === undefined || grant.expiresAt <= this.now() || grant.clientId !== clientId || grant.redirectUri !== (params.get('redirect_uri') ?? '') || !verifyPkce(verifier, grant.codeChallenge)) {
        json(response, 400, { error: 'invalid_grant' }); return;
      }
      this.issueTokens(clientId, response);
      return;
    }
    if (grantType === 'refresh_token') {
      const refresh = params.get('refresh_token') ?? '';
      const grant = this.refreshTokens.get(refresh);
      if (grant === undefined || grant.expiresAt <= this.now() || grant.clientId !== clientId) {
        json(response, 400, { error: 'invalid_grant' }); return;
      }
      this.refreshTokens.delete(refresh);
      this.issueTokens(clientId, response);
      return;
    }
    json(response, 400, { error: 'unsupported_grant_type' });
  }

  private issueTokens(clientId: string, response: ServerResponse): void {
    const access = token(32);
    const refresh = token(32);
    this.accessTokens.set(access, { clientId, expiresAt: this.now() + ACCESS_TTL_MS });
    this.refreshTokens.set(refresh, { clientId, expiresAt: this.now() + REFRESH_TTL_MS });
    json(response, 200, { access_token: access, token_type: 'Bearer', expires_in: Math.floor(ACCESS_TTL_MS / 1000), refresh_token: refresh });
  }

  private validAccessToken(value: string): boolean {
    const grant = this.accessTokens.get(value);
    if (grant === undefined) return false;
    if (grant.expiresAt <= this.now()) { this.accessTokens.delete(value); return false; }
    return true;
  }

  private issuePairingCode(): void {
    this.pairingCode = String(randomInt(0, 1_000_000)).padStart(6, '0');
    this.pairingExpiresAt = this.now() + PAIRING_TTL_MS;
    this.pairingFailures = 0;
  }

  private verifyPairingCode(value: string): boolean {
    if (this.pairingCode === null || this.now() >= this.pairingExpiresAt || !/^\d{6}$/.test(value)) return false;
    const accepted = timingSafeEqual(Buffer.from(value), Buffer.from(this.pairingCode));
    if (accepted) return true;
    this.pairingFailures += 1;
    if (this.pairingFailures >= 5) {
      this.pairingCode = null;
      this.pairingExpiresAt = 0;
    }
    return false;
  }

  private requirePublicOrigin(): string {
    if (this.publicOrigin === null) throw new Error('Remote MCP public URL is not ready');
    return this.publicOrigin;
  }

  private secretDir(): string { return path.join(this.dataPath, 'remote-mcp'); }
  private secretPath(): string { return path.join(this.secretDir(), 'ngrok-authtoken.secret'); }
  private async hasAuthtoken(): Promise<boolean> { return (await this.loadAuthtoken().catch(() => null)) !== null; }
  private async loadAuthtoken(): Promise<string | null> {
    try {
      const encrypted = await readFile(this.secretPath(), 'utf8');
      const value = (await unprotectTunnelSecret(encrypted)).trim();
      return value.length > 0 ? value : null;
    } catch { return null; }
  }

  private async stopOwnedRuntime(): Promise<void> {
    const child = this.ngrok;
    this.ngrok = null;
    this.publicOrigin = null;
    this.pairingCode = null;
    this.pairingExpiresAt = 0;
    if (child !== null && child.exitCode === null) {
      child.kill();
      await new Promise<void>((resolve) => { const timer = setTimeout(resolve, 1_500); child.once('exit', () => { clearTimeout(timer); resolve(); }); });
    }
    const server = this.gateway;
    this.gateway = null;
    this.gatewayUrl = null;
    if (server !== null) await new Promise<void>((resolve) => server.close(() => resolve()));
    this.clients.clear();
    this.authCodes.clear();
    this.accessTokens.clear();
    this.refreshTokens.clear();
  }
}

export async function resolveNgrokExecutable(): Promise<string | null> {
  if (process.platform !== 'win32') return null;
  try {
    const output = await runCommand('where.exe', ['ngrok.exe'], 5_000);
    const candidate = output.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
    return candidate ?? null;
  } catch { return null; }
}

async function waitForNgrokPublicOrigin(timeoutMs: number): Promise<string | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(NGROK_API, { signal: AbortSignal.timeout(1_500) });
      if (response.ok) {
        const body = await response.json() as { tunnels?: Array<{ public_url?: unknown }> };
        const value = body.tunnels?.map((entry) => entry.public_url).find((entry): entry is string => typeof entry === 'string' && entry.startsWith('https://'));
        if (value !== undefined) return value.replace(/\/$/, '');
      }
    } catch { /* retry while ngrok boots */ }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return null;
}

async function proxyMcp(request: IncomingMessage, response: ServerResponse, target: string): Promise<void> {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (value === undefined || ['host', 'authorization', 'origin', 'content-length', 'connection', 'forwarded', 'x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto'].includes(name.toLowerCase())) continue;
    if (Array.isArray(value)) value.forEach((entry) => headers.append(name, entry));
    else headers.set(name, value);
  }
  const body = request.method === 'GET' || request.method === 'HEAD' ? undefined : await readBuffer(request, 4 * 1024 * 1024);
  const upstreamBody = body === undefined ? undefined : new Uint8Array(body);
  const upstream = await fetch(target, { method: request.method ?? 'GET', headers, ...(upstreamBody === undefined ? {} : { body: upstreamBody }) });
  response.statusCode = upstream.status;
  upstream.headers.forEach((value, name) => {
    if (!['content-encoding', 'content-length', 'transfer-encoding', 'connection'].includes(name.toLowerCase())) response.setHeader(name, value);
  });
  if (upstream.body === null) { response.end(); return; }
  const reader = upstream.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!response.write(Buffer.from(value))) await new Promise<void>((resolve) => response.once('drain', resolve));
    }
  } finally { reader.releaseLock(); }
  response.end();
}

async function readJson(request: IncomingMessage, max: number): Promise<Record<string, unknown>> {
  const text = await readText(request, max);
  const value: unknown = JSON.parse(text);
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('JSON object required');
  return value as Record<string, unknown>;
}

async function readText(request: IncomingMessage, max: number): Promise<string> { return (await readBuffer(request, max)).toString('utf8'); }
async function readBuffer(request: IncomingMessage, max: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > max) throw new Error('Request body is too large');
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

function json(response: ServerResponse, status: number, value: unknown): void {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.end(JSON.stringify(value));
}
function html(response: ServerResponse, status: number, body: string): void {
  response.statusCode = status;
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'");
  response.end(body);
}
function token(bytes: number): string { return randomBytes(bytes).toString('base64url'); }
function verifyPkce(verifier: string, challenge: string): boolean {
  if (verifier.length < 43 || verifier.length > 128) return false;
  const actual = createHash('sha256').update(verifier, 'ascii').digest('base64url');
  return actual.length === challenge.length && timingSafeEqual(Buffer.from(actual), Buffer.from(challenge));
}
function parseBearer(value: string | undefined): string | null {
  const match = /^Bearer\s+([^\s]+)$/i.exec(value ?? '');
  return match?.[1] ?? null;
}
function isSafeRedirectUri(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || ((url.hostname === '127.0.0.1' || url.hostname === 'localhost') && url.protocol === 'http:');
  } catch { return false; }
}
function escapeHtml(value: string): string { return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char); }
function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }
function redactNgrokError(value: string): string { return value.replace(/(authtoken|token)[=:"'\s]+[^\s,"']+/gi, '$1=[redacted]').slice(0, 500); }

function runCommand(executable: string, args: readonly string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, [...args], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error(`${executable} timed out`)); }, timeoutMs);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => { stdout += chunk; });
    child.stderr.on('data', (chunk: string) => { stderr += chunk; });
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
    child.once('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(stderr.trim() || `${executable} exited with code ${code ?? 'unknown'}`));
    });
  });
}
