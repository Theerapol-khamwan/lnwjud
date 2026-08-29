import { describe, expect, it } from 'vitest';
import { remediationNavigationForTarget } from '../src/renderer/features/tools/remediation-navigation.js';

describe('Doctor/Tools remediation navigation', () => {
  it('opens each remediation target at the intended screen and settings section', () => {
    expect(remediationNavigationForTarget('projects')).toEqual({ screen: 'projects' });
    expect(remediationNavigationForTarget('tools')).toEqual({ screen: 'settings', section: 'tools' });
    expect(remediationNavigationForTarget('tunnel')).toEqual({ screen: 'settings', section: 'tunnel' });
    expect(remediationNavigationForTarget('extensions')).toEqual({ screen: 'settings', section: 'mcp' });
    expect(remediationNavigationForTarget('mcp')).toEqual({ screen: 'settings', section: 'mcp' });
    expect(remediationNavigationForTarget('security')).toEqual({ screen: 'settings', section: 'security' });
    expect(remediationNavigationForTarget('backup')).toEqual({ screen: 'settings', section: 'backup' });
    expect(remediationNavigationForTarget('general')).toEqual({ screen: 'settings', section: 'general' });
  });

  it('rejects unknown targets instead of silently opening General settings', () => {
    expect(remediationNavigationForTarget('unknown-section')).toBeNull();
  });
});
