import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('scheduled continuation skill contract', () => {
  it('documents the T+25 cloud same-task +2 lease-generation workflow', async () => {
    const skill = await readFile(path.resolve(process.cwd(), '../../.agents/skills/lnwjud-scheduled-continuation/SKILL.md'), 'utf8');
    expect(skill).toContain('25 minutes');
    expect(skill).toContain('same native task');
    expect(skill).toContain('+2 minutes');
    expect(skill).toContain('without a retry limit');
    expect(skill).toContain('runsOn: cloud');
    expect(skill).toContain('claim_scheduled_continuation');
    expect(skill).toContain('expedite_scheduled_continuation');
    expect(skill).toContain('goalLease');
    expect(skill).toContain('orphan_recovered');
    expect(skill).toContain('cancel');
    expect(skill).toContain('native host deletion receipt');
    expect(skill).toContain('Never report cancellation as successful');
    expect(skill).not.toMatch(/retry_prepared|Windows Task Scheduler as fallback/i);
  });
});
