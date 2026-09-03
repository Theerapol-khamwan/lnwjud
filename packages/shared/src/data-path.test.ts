import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveLnwjudDataPath } from './data-path.js';

describe('resolveLnwjudDataPath', () => {
  it('uses the same explicit override for Desktop and MCP', () => {
    expect(resolveLnwjudDataPath({ LNWJUD_DATA_PATH: 'D:\\agent-data', APPDATA: 'C:\\Users\\u\\AppData\\Roaming' }, undefined, 'win32')).toBe(path.win32.resolve('D:\\agent-data'));
  });

  it('defaults to the per-user roaming AppData lnwjud directory', () => {
    expect(resolveLnwjudDataPath({ APPDATA: 'C:\\Users\\u\\AppData\\Roaming' }, undefined, 'win32')).toBe(path.win32.resolve('C:\\Users\\u\\AppData\\Roaming\\lnwjud'));
  });

  it('accepts Electron appData as a fallback without embedding a build-machine profile', () => {
    expect(resolveLnwjudDataPath({}, 'C:\\Users\\end-user\\AppData\\Roaming', 'win32')).toBe(path.win32.resolve('C:\\Users\\end-user\\AppData\\Roaming\\lnwjud'));
  });

  it('uses the macOS Application Support location for a direct stdio host', () => {
    expect(resolveLnwjudDataPath({ HOME: '/Users/end-user', APPDATA: 'C:\\ignored' }, undefined, 'darwin'))
      .toBe('/Users/end-user/Library/Application Support/lnwjud');
  });

  it('uses Electron appData on macOS when it is available', () => {
    expect(resolveLnwjudDataPath({ HOME: '/Users/end-user' }, '/Users/end-user/Library/Application Support', 'darwin'))
      .toBe('/Users/end-user/Library/Application Support/lnwjud');
  });
});
