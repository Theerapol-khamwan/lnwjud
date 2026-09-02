import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const settingsSource = readFileSync(new URL('../src/renderer/features/settings/SettingsPage.tsx', import.meta.url), 'utf8');

describe('Remote MCP ngrok settings UI', () => {
  it('treats a verified executable as ready and disables redundant reinstall', () => {
    expect(settingsSource).toContain("const ngrokReady = remoteMcp.installed && remoteMcp.ngrokPath !== null;");
    expect(settingsSource).toContain("remoteMcp.state === 'running' || ngrokReady");
    expect(settingsSource).toContain('ngrok ติดตั้งแล้วและพร้อมใช้งาน');
    expect(settingsSource).toContain('✓ ngrok พร้อมใช้งาน');
    expect(settingsSource).toContain('running `ngrok version`');
  });
});
