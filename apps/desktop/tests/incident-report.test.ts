import { describe, expect, it } from 'vitest';
import {
  buildIncidentReport,
  classifyIncident,
  exportIncidentReport,
  pairMcpCalls,
  parseTunnelCorrelations,
  type IncidentEvidence,
} from '../src/main/incident-report.js';

const healthyTunnel = { state: 'running' as const, source: 'desktop' as const, message: null, health: { healthy: true, message: 'ok' } };

function evidence(overrides: Partial<IncidentEvidence> = {}): IncidentEvidence {
  return {
    triggeredByUser: true,
    appVersion: '4.0.1',
    tunnelClientVersion: '1.2.3',
    tunnel: healthyTunnel,
    updaterEvents: [],
    logLines: [],
    ...overrides,
  };
}

describe('incident classification', () => {
  it.each([
    ['local_tool_failed', evidence({ logLines: [{ source: 'mcp', text: '[ERROR] read_file FAILED — access denied', timestamp: '2026-08-20T00:00:00.000Z' }] })],
    ['tunnel_disconnected', evidence({ logLines: [{ source: 'tunnel', text: 'stdio command exited', timestamp: '2026-08-20T00:00:00.000Z' }] })],
    ['remote_turn_stopped', evidence({ logLines: [{ source: 'mcp', text: '[RESULT] read_file SUCCESS', timestamp: '2026-08-20T00:00:00.000Z' }] })],
    ['healthy_or_inconclusive', evidence({ triggeredByUser: false, logLines: [{ source: 'mcp', text: '[RESULT] read_file SUCCESS', timestamp: '2026-08-20T00:00:00.000Z' }] })],
  ] as const)('returns %s only from supported evidence', (classification, input) => {
    expect(classifyIncident(input).classification).toBe(classification);
  });

  it('gives local failure precedence over a conflicting tunnel disconnect', () => {
    const result = classifyIncident(evidence({ logLines: [
      { source: 'tunnel', text: 'connection max TTL reached', timestamp: '2026-08-20T00:00:00.000Z' },
      { source: 'mcp', text: '[ERROR] write_file FAILED — denied', timestamp: '2026-08-20T00:01:00.000Z' },
    ] }));
    expect(result).toMatchObject({ classification: 'local_tool_failed' });
  });

  it('does not call idle or periodic status a remote failure', () => {
    expect(classifyIncident(evidence({ logLines: [{ source: 'tunnel', text: 'periodic status: connected', timestamp: '2026-08-20T00:00:00.000Z' }] })).classification)
      .toBe('healthy_or_inconclusive');
  });
});

describe('incident correlation and privacy', () => {
  it('pairs interleaved MCP calls and retains orphan starts and completions', () => {
    expect(pairMcpCalls([
      { source: 'mcp', text: '[TASK] read_file callId=a — in flight', timestamp: '2026-08-20T00:00:00.000Z' },
      { source: 'mcp', text: '[RESULT] list_files SUCCESS callId=b', timestamp: '2026-08-20T00:00:01.000Z' },
      { source: 'mcp', text: '[RESULT] read_file SUCCESS callId=a', timestamp: '2026-08-20T00:00:02.000Z' },
      { source: 'mcp', text: '[TASK] write_file callId=c — in flight', timestamp: '2026-08-20T00:00:03.000Z' },
    ])).toEqual(expect.arrayContaining([
      expect.objectContaining({ callId: 'a', incomplete: false, resultCode: 'SUCCESS' }),
      expect.objectContaining({ callId: 'b', incomplete: true, completionWithoutStart: true }),
      expect.objectContaining({ callId: 'c', incomplete: true, startedWithoutCompletion: true }),
    ]));
  });

  it('parses bounded tunnel instance and request ids despite malformed lines', () => {
    expect(parseTunnelCorrelations([
      { source: 'tunnel', text: 'bad { json', timestamp: '2026-08-20T00:00:00.000Z' },
      { source: 'tunnel', text: 'instance_id=inst-123 request_id=req-456', timestamp: '2026-08-20T00:00:01.000Z' },
    ])).toEqual({ instanceIds: ['inst-123'], requestIds: ['req-456'] });
  });

  it('bounds and redacts report text including representative secrets', async () => {
    const report = await buildIncidentReport(evidence({
      logLines: Array.from({ length: 260 }, (_, index) => ({ source: 'tunnel' as const, timestamp: '2026-08-20T00:00:00.000Z', text: `api_key=sk-live-secret-${index} Authorization: Bearer abc.def.ghi ${'x'.repeat(900)}` })),
      collectProcessTree: async () => [{ pid: 20, parentPid: 10, executable: 'tunnel-client.exe', commandLine: 'tunnel-client.exe --api-key sk-nope --profile lnwjud' }],
      collectListeners: async () => [{ pid: 20, address: '127.0.0.1', port: 7777, owner: 'tunnel-client.exe --token leaked' }],
    }));
    const serialized = JSON.stringify(report);
    expect(report.tunnelLogTail.length).toBeLessThanOrEqual(200);
    expect(serialized).not.toContain('sk-live-secret');
    expect(serialized).not.toContain('abc.def.ghi');
    expect(serialized).not.toContain('sk-nope');
    expect(serialized).not.toContain('--api-key');
    expect(serialized).not.toContain('--token');
  });

  it('keeps a usable report when read-only collectors fail', async () => {
    const report = await buildIncidentReport(evidence({
      collectProcessTree: async () => { throw new Error('access denied'); },
      collectListeners: async () => { throw new Error('netstat denied'); },
    }));
    expect(report.processTree).toEqual(expect.objectContaining({ available: false, error: 'access denied' }));
    expect(report.tcpListeners).toEqual(expect.objectContaining({ available: false, error: 'netstat denied' }));
  });
});

describe('incident export workflow', () => {
  it('returns a typed cancelled result without writing when the user cancels', async () => {
    const result = await exportIncidentReport(evidence(), {
      choosePath: async () => null,
      writeAtomically: async () => { throw new Error('must not write'); },
    });
    expect(result).toEqual({ exported: false, cancelled: true, classification: 'healthy_or_inconclusive' });
  });

  it('writes bounded JSON after a user chooses a path', async () => {
    let saved = '';
    const result = await exportIncidentReport(evidence(), {
      choosePath: async () => 'C:/tmp/incident.json',
      writeAtomically: async (_path, content) => { saved = content; },
    });
    expect(result).toEqual({ exported: true, cancelled: false, classification: 'healthy_or_inconclusive' });
    expect(JSON.parse(saved)).toMatchObject({ schemaVersion: 1, classification: 'healthy_or_inconclusive' });
  });
});
