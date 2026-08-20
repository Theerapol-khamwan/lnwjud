import { describe, expect, it } from 'vitest';
import {
  buildIncidentReport,
  classifyIncident,
  exportIncidentReport,
  pairMcpCalls,
  parseTunnelCorrelations,
  type IncidentEvidence,
} from '../src/main/incident-report.js';

const healthyTunnel = { state: 'running' as const, source: 'desktop' as const, message: null, health: { state: 'live' as const, message: 'tunnel health endpoint live' } };
const started = (callId: string, toolName = 'read_file'): { source: 'mcp'; text: string; timestamp: string; correlation: { kind: 'mcp'; phase: 'started'; callId: string; toolName: string; resultCode: null } } => ({ source: 'mcp', text: 'display text only', timestamp: '2026-08-20T00:00:00.000Z', correlation: { kind: 'mcp', phase: 'started', callId, toolName, resultCode: null } });
const completed = (callId: string, resultCode: 'SUCCESS' | 'FAILED' = 'SUCCESS', toolName = 'read_file'): { source: 'mcp'; text: string; timestamp: string; correlation: { kind: 'mcp'; phase: 'completed'; callId: string; toolName: string; resultCode: 'SUCCESS' | 'FAILED' } } => ({ source: 'mcp', text: 'display text only', timestamp: '2026-08-20T00:00:01.000Z', correlation: { kind: 'mcp', phase: 'completed', callId, toolName, resultCode } });

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
    ['local_tool_failed', evidence({ logLines: [started('a'), completed('a', 'FAILED')] })],
    ['tunnel_disconnected', evidence({ logLines: [{ source: 'tunnel', text: 'stdio command exited', timestamp: '2026-08-20T00:00:00.000Z' }] })],
    ['remote_turn_stopped', evidence({ logLines: [started('a'), completed('a')] })],
    ['healthy_or_inconclusive', evidence({ triggeredByUser: false, logLines: [started('a'), completed('a')] })],
  ] as const)('returns %s only from supported evidence', (classification, input) => {
    expect(classifyIncident(input).classification).toBe(classification);
  });

  it('gives local failure precedence over a conflicting tunnel disconnect', () => {
    const result = classifyIncident(evidence({ logLines: [
      { source: 'tunnel', text: 'connection max TTL reached', timestamp: '2026-08-20T00:00:00.000Z' },
      started('a', 'write_file'), completed('a', 'FAILED', 'write_file'),
    ] }));
    expect(result).toMatchObject({ classification: 'local_tool_failed' });
  });

  it('does not call idle or periodic status a remote failure', () => {
    expect(classifyIncident(evidence({ logLines: [{ source: 'tunnel', text: 'periodic status: connected', timestamp: '2026-08-20T00:00:00.000Z' }] })).classification)
      .toBe('healthy_or_inconclusive');
  });

  it('requires an explicitly live tunnel, not local MCP or text keywords', () => {
    expect(classifyIncident(evidence({ logLines: [started('a', 'success_error_tool'), completed('a', 'SUCCESS', 'success_error_tool')], tunnel: { ...healthyTunnel, health: { state: 'unavailable', message: 'local MCP is live' } } })).classification).toBe('healthy_or_inconclusive');
    expect(classifyIncident(evidence({ logLines: [started('a'), completed('a')], tunnel: { ...healthyTunnel, state: 'starting', health: { state: 'live', message: 'live' } } })).classification).toBe('healthy_or_inconclusive');
    expect(classifyIncident(evidence({ logLines: [started('a'), completed('a')], tunnel: { ...healthyTunnel, state: 'stopped', health: { state: 'live', message: 'live' } } })).classification).toBe('tunnel_disconnected');
  });

  it('treats missing, new, or conflicting terminal result codes as unknown', () => {
    const unknown = completed('a', 'SUCCESS');
    unknown.correlation.resultCode = 'UNKNOWN_CODE' as never;
    expect(classifyIncident(evidence({ logLines: [started('a', 'tool_success_error'), unknown] })).classification).toBe('healthy_or_inconclusive');
    expect(classifyIncident(evidence({ logLines: [started('b'), { ...completed('b'), correlation: { ...completed('b').correlation, resultCode: null } }] })).classification).toBe('healthy_or_inconclusive');
  });

  it.each(['TTL reached!', 'stdio process terminated.', 'Tunnel is shutting down', 'DISCONNECTING now'])('recognizes tunnel lifecycle failure %s', (text) => {
    expect(classifyIncident(evidence({ logLines: [{ source: 'tunnel', text, timestamp: '2026-08-20T00:00:00.000Z' }] })).classification).toBe('tunnel_disconnected');
  });
});

describe('incident correlation and privacy', () => {
  it('pairs interleaved MCP calls and retains orphan starts and completions', () => {
    expect(pairMcpCalls([
      started('a'), completed('b'), completed('a'), started('c'),
    ])).toEqual(expect.arrayContaining([
      expect.objectContaining({ callId: 'a', incomplete: false, resultCode: 'SUCCESS' }),
      expect.objectContaining({ callId: 'b', incomplete: true, completionWithoutStart: true }),
      expect.objectContaining({ callId: 'c', incomplete: true, startedWithoutCompletion: true }),
    ]));
  });

  it('keeps repeated callId occurrences separate in chronological queues', () => {
    const calls = pairMcpCalls([started('same'), started('same', 'write_file'), completed('same'), completed('same', 'SUCCESS', 'write_file'), completed('orphan')]);
    expect(calls.filter((call) => call.callId === 'same')).toHaveLength(2);
    expect(calls.at(-1)).toMatchObject({ callId: 'orphan', completionWithoutStart: true });
  });

  it('parses bounded tunnel instance and request ids despite malformed lines', () => {
    expect(parseTunnelCorrelations([
      { source: 'tunnel', text: 'bad { json', timestamp: '2026-08-20T00:00:00.000Z' },
      { source: 'tunnel', text: 'structured only', timestamp: '2026-08-20T00:00:01.000Z', correlation: { kind: 'tunnel' as const, instanceId: 'inst-123', requestId: 'req-456' } },
    ])).toEqual({ instanceIds: ['inst-123'], requestIds: ['req-456'] });
  });

  it('bounds and redacts report text including representative secrets', async () => {
    const report = await buildIncidentReport(evidence({
      logLines: Array.from({ length: 260 }, (_, index) => ({ source: 'tunnel' as const, timestamp: '2026-08-20T00:00:00.000Z', text: `api_key=sk-live-secret-${index} Authorization: Bearer abc.def.ghi\nAuthorization: Basic dXNlcjpwYXNz https://x/?token=very-secret {"apiKey":"json-secret"} X-Api-Key: newline-secret ${'x'.repeat(900)}` })),
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
    for (const secret of ['Basic dXNlcjpwYXNz', 'Bearer abc.def.ghi', 'token=very-secret', '"apiKey":"json-secret"', 'X-Api-Key: newline-secret']) expect(serialized).not.toContain(secret);
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
    expect(result).toEqual({ exported: false, cancelled: true, classification: 'healthy_or_inconclusive', capturedAt: null });
  });

  it('writes bounded JSON after a user chooses a path', async () => {
    let saved = '';
    const result = await exportIncidentReport(evidence(), {
      choosePath: async () => 'C:/tmp/incident.json',
      writeAtomically: async (_path, content) => { saved = content; },
    });
    expect(result).toMatchObject({ exported: true, cancelled: false, classification: 'healthy_or_inconclusive', capturedAt: expect.any(String) });
    expect(JSON.parse(saved)).toMatchObject({ schemaVersion: 1, classification: 'healthy_or_inconclusive' });
  });
});
