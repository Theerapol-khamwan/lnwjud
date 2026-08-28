import { describe, expect, it } from 'vitest';
import { OFFICIAL_URL_TARGETS, COPY_COMMANDS, RemediationRegistry } from '../src/main/tool-catalog/remediation-registry.js';
import { RequirementRegistry } from '../src/main/tool-catalog/requirement-registry.js';


describe('tool catalog security boundaries', () => {
  it('exposes only typed allowlisted remediation actions', () => {
    const registry = new RemediationRegistry();
    const resolved = registry.resolve('en');
    for (const remediation of resolved) {
      for (const action of remediation.actions) {
        expect(['open_settings', 'open_official_url', 'copy_command', 'recheck']).toContain(action.kind);
        if (action.kind === 'open_official_url') expect(action.target in OFFICIAL_URL_TARGETS).toBe(true);
        if (action.kind === 'copy_command') expect(action.commandId in COPY_COMMANDS).toBe(true);
        if (action.kind === 'open_settings') expect(action.target).not.toMatch(/^https?:/i);
      }
    }
  });

  it('rejects unknown remediation ids instead of trusting renderer text', () => {
    expect(() => new RemediationRegistry().resolve('en', ['https://evil.example'])).toThrow(/Unknown remediation id/);
  });

  it('bounds probe detail and isolates thrown probes as unknown', async () => {
    const registry = new RequirementRegistry([{
      id: 'probe', required: true, summaryKey: 'probe', remediationId: 'recheck_runtime',
      probe: async (): Promise<never> => { throw new Error('x'.repeat(10_000)); },
    }]);
    const result = (await registry.probe()).get('probe');
    expect(result?.status).toBe('unknown');
    expect(result?.detail?.length).toBeLessThanOrEqual(2_048);
  });
});
