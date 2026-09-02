import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const settingsSource = readFileSync(new URL('../src/renderer/features/settings/SettingsPage.tsx', import.meta.url), 'utf8');
const homeSource = readFileSync(new URL('../src/renderer/features/home/ControlCenterPage.tsx', import.meta.url), 'utf8');

describe('Remote MCP ngrok settings UI', () => {
  it('treats a verified executable as ready and disables redundant reinstall', () => {
    expect(settingsSource).toContain("const ngrokReady = remoteMcp.installed && remoteMcp.ngrokPath !== null;");
    expect(settingsSource).toContain("remoteMcp.state === 'running' || ngrokReady");
    expect(settingsSource).toContain('ngrok ติดตั้งแล้วและพร้อมใช้งาน');
    expect(settingsSource).toContain('✓ ngrok พร้อมใช้งาน');
    expect(settingsSource).toContain('running `ngrok version`');
    expect(settingsSource).toContain('ngrok-readiness-banner');
    expect(settingsSource).toContain('ngrok-ready-path');
  });

  it('separates recommended OAuth from the optional Secure Tunnel method', () => {
    expect(settingsSource).toContain('เลือกวิธีเชื่อมต่อหลัก 1 วิธี');
    expect(settingsSource).toContain('connection-method-stack is-recommended');
    expect(settingsSource).toContain("setSecureMethodOpen(false)");
    expect(settingsSource).toContain('ผู้ใช้ที่ต้องการสามารถเปิดทั้งสองพร้อมกันได้');
    expect(homeSource).toContain('setSecureTunnelExpanded(!remoteMcpOnline)');
    expect(homeSource).toContain('Remote MCP OAuth ออนไลน์แล้ว จึงพับส่วน Tunnel ไว้เพื่อลดความสับสน');
  });
});
