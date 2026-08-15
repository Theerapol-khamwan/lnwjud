import { describe, expect, it } from 'vitest';
import { wrapWindowsCommandShim } from './windows-spawn.js';

describe('wrapWindowsCommandShim', () => {
  it('keeps cmd /s from stripping quotes around a path with spaces', () => {
    const result = wrapWindowsCommandShim('C:\\Program Files\\nodejs\\npm.cmd', ['run', 'check']);

    expect(result).toMatchObject({
      ok: true,
      value: {
        args: ['/d', '/s', '/c', '""C:\\Program Files\\nodejs\\npm.cmd" run check"'],
        windowsVerbatimArguments: true,
      },
    });
  });

  it('rejects shell metacharacters unless they are explicitly allowed', () => {
    expect(wrapWindowsCommandShim('C:\\tools\\tool.cmd', ['&', 'whoami'])).toMatchObject({
      ok: false,
      error: { code: 'INVALID_INPUT' },
    });
    expect(wrapWindowsCommandShim('C:\\tools\\tool.cmd', ['&', 'whoami'], { allowMetacharacters: true })).toMatchObject({
      ok: true,
      value: { args: ['/d', '/s', '/c', '"C:\\tools\\tool.cmd & whoami"'] },
    });
  });
});
