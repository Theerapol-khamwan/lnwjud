import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

export async function protectTunnelSecret(plainText: string): Promise<string> {
  if (process.platform === 'darwin') return protectMacosKeychainSecret(plainText);
  const script = [
    '$ErrorActionPreference = "Stop"',
    '$plain = [Console]::In.ReadToEnd()',
    '$secure = ConvertTo-SecureString -String $plain -AsPlainText -Force',
    'ConvertFrom-SecureString -SecureString $secure',
  ].join('; ');
  return runWindowsPowerShellWithStdin(script, plainText);
}

export async function unprotectTunnelSecret(cipherText: string): Promise<string> {
  if (process.platform === 'darwin') return unprotectMacosKeychainSecret(cipherText);
  const script = [
    '$ErrorActionPreference = "Stop"',
    '$encrypted = [Console]::In.ReadToEnd().Trim()',
    '$secure = ConvertTo-SecureString -String $encrypted',
    '$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)',
    'try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }',
  ].join('; ');
  return runWindowsPowerShellWithStdin(script, cipherText);
}

export function resolveWindowsPowerShellExecutable(environment: NodeJS.ProcessEnv = process.env): string {
  const systemRoot = environment.SystemRoot ?? environment.WINDIR;
  if (systemRoot === undefined || systemRoot.trim().length === 0) {
    throw new Error('Windows PowerShell is unavailable because SystemRoot/WINDIR is not set');
  }
  return path.win32.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
}

export function buildWindowsPowerShellChildEnv(environment: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const childEnvironment: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(environment)) {
    if (name.toLowerCase() !== 'psmodulepath') childEnvironment[name] = value;
  }
  return childEnvironment;
}

function runWindowsPowerShellWithStdin(command: string, input: string): Promise<string> {
  if (process.platform !== 'win32') return Promise.reject(new Error('Windows DPAPI is only available on Windows'));
  return new Promise((resolve, reject) => {
    const child = spawn(
      resolveWindowsPowerShellExecutable(),
      ['-NoProfile', '-NonInteractive', '-Command', command],
      {
        env: buildWindowsPowerShellChildEnv(),
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    );
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => { stdout += chunk; });
    child.stderr.on('data', (chunk: string) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || `PowerShell exited with code ${code ?? 'unknown'}`));
        return;
      }
      const value = stdout.replace(/\r?\n$/, '');
      if (value.length === 0) {
        reject(new Error('PowerShell returned an empty result'));
        return;
      }
      resolve(value);
    });
    child.stdin.end(input, 'utf8');
  });
}

const MACOS_KEYCHAIN_PREFIX = 'macos-keychain:';
const MACOS_KEYCHAIN_ACCOUNT = 'lnwjud';

/**
 * macOS has no DPAPI equivalent exposed by Node.  Keep the secret in the
 * login keychain and put only an opaque keychain reference in the profile.
 */
async function protectMacosKeychainSecret(plainText: string): Promise<string> {
  if (plainText.length === 0) throw new Error('Secret must not be empty');
  const id = randomUUID();
  await runMacosKeychainHelper('keychain_set', { service: macosKeychainService(id), account: MACOS_KEYCHAIN_ACCOUNT, secret: plainText });
  return `${MACOS_KEYCHAIN_PREFIX}${id}`;
}

async function unprotectMacosKeychainSecret(reference: string): Promise<string> {
  if (!reference.startsWith(MACOS_KEYCHAIN_PREFIX)) throw new Error('Invalid macOS Keychain secret reference');
  const id = reference.slice(MACOS_KEYCHAIN_PREFIX.length);
  // Preserve secrets written by early macOS previews (a SHA-256 reference)
  // while new profiles use an opaque UUID that does not reveal a token digest.
  if (!/^(?:[a-f0-9]{64}|[a-f0-9-]{36})$/i.test(id)) throw new Error('Invalid macOS Keychain secret reference');
  const result = await runMacosKeychainHelper('keychain_get', { service: macosKeychainService(id), account: MACOS_KEYCHAIN_ACCOUNT });
  if (typeof result.secret !== 'string' || result.secret.length === 0) throw new Error('macOS Keychain returned an empty secret');
  return result.secret;
}

function macosKeychainService(id: string): string {
  return `com.lnwjud.tunnel.${id}`;
}

/** The helper receives secret material only through stdin, never a process argument. */
function runMacosKeychainHelper(operation: 'keychain_get' | 'keychain_set', input: Record<string, string>): Promise<Record<string, unknown>> {
  const helper = macosHelperPath();
  return new Promise((resolve, reject) => {
    const child = spawn(helper, [], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => { stdout += chunk; });
    child.stderr.on('data', (chunk: string) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || `macOS Keychain helper exited with code ${code ?? 'unknown'}`));
        return;
      }
      let response: unknown;
      try { response = JSON.parse(stdout.trim()); } catch { reject(new Error('macOS Keychain helper returned an invalid response')); return; }
      if (!isRecord(response) || response.ok !== true || !isRecord(response.value)) {
        const message = isRecord(response) && isRecord(response.error) && typeof response.error.message === 'string' ? response.error.message : '';
        reject(new Error(message || 'macOS Keychain helper failed'));
        return;
      }
      resolve(response.value);
    });
    child.stdin.end(JSON.stringify({ operation, input }), 'utf8');
  });
}

function macosHelperPath(): string {
  const configured = process.env.LNWJUD_MACOS_HELPER?.trim();
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  const candidates = [
    configured,
    path.resolve(process.cwd(), 'apps', 'desktop', 'build', 'lnwjud-macos-helper'),
    path.resolve(process.cwd(), 'build', 'lnwjud-macos-helper'),
    resourcesPath === undefined ? undefined : path.join(resourcesPath, 'lnwjud-macos-helper'),
    path.join(path.dirname(process.execPath), 'lnwjud-macos-helper'),
  ].filter((candidate): candidate is string => candidate !== undefined && candidate.length > 0);
  const helper = candidates.find((candidate) => existsSync(candidate));
  if (helper === undefined) throw new Error('macOS Keychain helper is unavailable; build the macOS lnwjud package first');
  return path.resolve(helper);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
