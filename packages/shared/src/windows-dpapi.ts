import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const KEY_PREFIX_V2 = 'dpapi:v2:';
const KEY_PREFIX_V1 = 'dpapi:v1:';
const MACOS_KEY_PREFIX = 'macos-keychain:v1:';
const MACOS_KEYCHAIN_ACCOUNT = 'lnwjud';
const DEFAULT_MAX_BUFFER = 1024 * 1024;

export function protectWithWindowsDpapi(plainText: string): string {
  if (plainText.length === 0) throw new Error('DPAPI plaintext must not be empty');
  const script = [
    '$ErrorActionPreference = "Stop"',
    "[Reflection.Assembly]::Load('System.Security, Version=4.0.0.0, Culture=neutral, PublicKeyToken=b03f5f7f11d50a3a') | Out-Null",
    '$plain = [Console]::In.ReadToEnd()',
    '$bytes = [Text.Encoding]::UTF8.GetBytes($plain)',
    '$protected = [Security.Cryptography.ProtectedData]::Protect($bytes, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)',
    '[Convert]::ToBase64String($protected)',
  ].join('; ');
  return runPowerShellDpapi(script, plainText);
}

export function unprotectWithWindowsDpapi(cipherText: string): string {
  if (cipherText.trim().length === 0) throw new Error('DPAPI ciphertext must not be empty');
  const script = [
    '$ErrorActionPreference = "Stop"',
    "[Reflection.Assembly]::Load('System.Security, Version=4.0.0.0, Culture=neutral, PublicKeyToken=b03f5f7f11d50a3a') | Out-Null",
    '$encrypted = [Console]::In.ReadToEnd().Trim()',
    '$protected = [Convert]::FromBase64String($encrypted)',
    '$bytes = [Security.Cryptography.ProtectedData]::Unprotect($protected, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)',
    '[Text.Encoding]::UTF8.GetString($bytes)',
  ].join('; ');
  return runPowerShellDpapi(script, cipherText);
}

export function loadOrCreateWindowsProtectedKey(filePath: string, byteLength = 32): Buffer {
  if (!Number.isInteger(byteLength) || byteLength < 16 || byteLength > 64) throw new Error('Invalid protected key length');
  const absolutePath = path.resolve(filePath);
  mkdirSync(path.dirname(absolutePath), { recursive: true });
  try {
    const stored = readFileSync(absolutePath, 'utf8');
    const decoded = decodeProtectedKey(stored, byteLength);
    if (stored.trim().startsWith(KEY_PREFIX_V1)) writeProtectedKeyV2(absolutePath, decoded);
    return decoded;
  } catch (error) {
    if (!isMissingFile(error)) throw error;
  }

  const generated = randomBytes(byteLength);
  const protectedValue = encodeProtectedKeyV2(generated);
  try {
    writeFileSync(absolutePath, protectedValue, { encoding: 'utf8', flag: 'wx' });
    return generated;
  } catch (error) {
    if (!isAlreadyExists(error)) throw error;
    return decodeProtectedKey(readFileSync(absolutePath, 'utf8'), byteLength);
  }
}

export function loadCheckpointEncryptionKey(dataPath: string): Buffer {
  const configured = process.env.LNWJUD_CHECKPOINT_KEY_BASE64;
  if (configured !== undefined && configured.trim().length > 0) {
    const key = Buffer.from(configured.trim(), 'base64');
    if (key.byteLength !== 32) throw new Error('LNWJUD_CHECKPOINT_KEY_BASE64 must decode to 32 bytes');
    return key;
  }
  const keyPath = path.join(dataPath, 'checkpoint-master.key');
  if (process.platform === 'darwin') return loadOrCreateMacosKeychainKey(keyPath, 32);
  return loadOrCreateWindowsProtectedKey(keyPath, 32);
}

/** Keep checkpoint material in the login Keychain; the profile only holds its service reference. */
function loadOrCreateMacosKeychainKey(filePath: string, byteLength: number): Buffer {
  if (!Number.isInteger(byteLength) || byteLength < 16 || byteLength > 64) throw new Error('Invalid protected key length');
  const absolutePath = path.resolve(filePath);
  mkdirSync(path.dirname(absolutePath), { recursive: true });
  const service = macosKeychainService(absolutePath);
  try {
    const stored = readFileSync(absolutePath, 'utf8').trim();
    if (stored !== `${MACOS_KEY_PREFIX}${service}`) throw new Error('Protected key file has an unsupported format');
    return decodeMacosKeychainKey(readMacosKeychainSecret(service), byteLength);
  } catch (error) {
    if (!isMissingFile(error)) throw error;
  }

  const generated = randomBytes(byteLength);
  writeMacosKeychainSecret(service, generated.toString('base64'));
  try {
    writeFileSync(absolutePath, `${MACOS_KEY_PREFIX}${service}`, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    return generated;
  } catch (error) {
    if (!isAlreadyExists(error)) throw error;
    const stored = readFileSync(absolutePath, 'utf8').trim();
    if (stored !== `${MACOS_KEY_PREFIX}${service}`) throw new Error('Protected key file has an unsupported format');
    return decodeMacosKeychainKey(readMacosKeychainSecret(service), byteLength);
  }
}

function macosKeychainService(filePath: string): string {
  return `com.lnwjud.checkpoint.${Buffer.from(filePath).toString('base64url')}`;
}

function readMacosKeychainSecret(service: string): string {
  const result = runMacosKeychainHelper('keychain_get', { service, account: MACOS_KEYCHAIN_ACCOUNT });
  const value = typeof result.secret === 'string' ? result.secret : '';
  if (value.length === 0) throw new Error('macOS Keychain returned an empty result');
  return value;
}

function writeMacosKeychainSecret(service: string, value: string): void {
  runMacosKeychainHelper('keychain_set', { service, account: MACOS_KEYCHAIN_ACCOUNT, secret: value });
}

/** The secret travels via stdin, never a `security -w` process argument. */
function runMacosKeychainHelper(operation: 'keychain_get' | 'keychain_set', input: Record<string, string>): Record<string, unknown> {
  const helper = macosHelperPath();
  const result = spawnSync(helper, [], {
    input: JSON.stringify({ operation, input }),
    encoding: 'utf8',
    maxBuffer: DEFAULT_MAX_BUFFER,
  });
  if (result.error !== undefined) throw result.error;
  let response: unknown;
  try { response = JSON.parse((result.stdout ?? '').trim()); } catch { throw new Error((result.stderr ?? '').trim() || 'macOS Keychain helper returned an invalid response'); }
  const record = asRecord(response);
  if (record === undefined || record.ok !== true || asRecord(record.value) === undefined) {
    const error = record?.error;
    const message = typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string' ? error.message : '';
    throw new Error(message || (result.stderr ?? '').trim() || 'macOS Keychain helper failed');
  }
  return asRecord(record.value)!;
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

function decodeMacosKeychainKey(value: string, expectedLength: number): Buffer {
  const key = Buffer.from(value.trim(), 'base64');
  if (key.byteLength !== expectedLength) throw new Error('Protected key file has an invalid key length');
  return key;
}

function encodeProtectedKeyV2(key: Buffer): string {
  return KEY_PREFIX_V2 + protectWithWindowsDpapi(key.toString('base64'));
}

function writeProtectedKeyV2(filePath: string, key: Buffer): void {
  writeFileSync(filePath, encodeProtectedKeyV2(key), { encoding: 'utf8' });
}

function decodeProtectedKey(value: string, expectedLength: number): Buffer {
  const trimmed = value.trim();
  let plain: string;
  if (trimmed.startsWith(KEY_PREFIX_V2)) {
    plain = unprotectWithWindowsDpapi(trimmed.slice(KEY_PREFIX_V2.length));
  } else if (trimmed.startsWith(KEY_PREFIX_V1)) {
    plain = unprotectLegacySecureString(trimmed.slice(KEY_PREFIX_V1.length));
  } else {
    throw new Error('Protected key file has an unsupported format');
  }
  const key = Buffer.from(plain.trim(), 'base64');
  if (key.byteLength !== expectedLength) throw new Error('Protected key file has an invalid key length');
  return key;
}

function unprotectLegacySecureString(cipherText: string): string {
  const script = [
    '$ErrorActionPreference = "Stop"',
    '$encrypted = [Console]::In.ReadToEnd().Trim()',
    '$secure = ConvertTo-SecureString -String $encrypted',
    '$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)',
    'try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }',
  ].join('; ');
  return runPowerShellDpapi(script, cipherText);
}

function runPowerShellDpapi(script: string, input: string): string {
  if (process.platform !== 'win32') throw new Error('Windows DPAPI is only available on Windows');
  const systemRoot = process.env.SystemRoot ?? process.env.WINDIR;
  const powershell = systemRoot === undefined
    ? 'powershell.exe'
    : path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const result = spawnSync(powershell, ['-NoProfile', '-NonInteractive', '-Command', script], {
    input,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: DEFAULT_MAX_BUFFER,
  });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) throw new Error((result.stderr ?? '').trim() || 'Windows DPAPI command failed');
  const value = (result.stdout ?? '').replace(/\r?\n$/, '');
  if (value.length === 0) throw new Error('Windows DPAPI command returned an empty result');
  return value;
}

function isMissingFile(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}

function isAlreadyExists(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'EEXIST';
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
