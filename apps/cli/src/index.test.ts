import { describe, expect, it } from 'vitest';
import { parseCliArgs } from './index.js';

describe('CLI argument parser', () => {
  it('parses workspace, MCP, doctor, and Codex doctor commands', () => {
    expect(parseCliArgs(['workspace', 'add', 'E:\\project'])).toEqual({ ok: true, value: { kind: 'workspace-add', rootPath: 'E:\\project' } });
    expect(parseCliArgs(['mcp', '--http', '--workspace', 'workspace-1'])).toEqual({ ok: true, value: { kind: 'mcp-http', workspaceReference: 'workspace-1' } });
    expect(parseCliArgs(['doctor'])).toEqual({ ok: true, value: { kind: 'doctor' } });
    expect(parseCliArgs(['codex', 'doctor'])).toEqual({ ok: true, value: { kind: 'codex-doctor' } });
  });

  it('rejects ambiguous MCP transport flags', () => {
    const parsed = parseCliArgs(['mcp', '--stdio', '--http']);
    expect(parsed.ok).toBe(false);
  });
});
