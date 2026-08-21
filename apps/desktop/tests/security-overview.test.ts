import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { DashboardSnapshot } from '@lnwjud/ipc-contracts';
import { ControlCenterPage } from '../src/renderer/features/home/ControlCenterPage.js';

const baseDashboard: DashboardSnapshot = {
  selectedWorkspace: null,
  gitSummary: { branch: null, changedFiles: 0, stagedFiles: 0, message: '' },
  mcp: { running: false, url: null, workspaceId: null },
  codex: { installed: false, version: null },
  managedProcessCount: 0,
  auditEventCount: 0,
  recentAuditEvents: [],
  permissionProfile: 'balanced',
  capabilities: [],
  agentState: 'idle',
  mode: 'WORK',
  locale: 'en',
  unrestricted: false,
  allowAiDelete: false,
  stdioPermissionProfile: 'balanced',
  stdioStrictRoots: true,
  stdioAllowedRoots: ['C:\\workspace'],
  backups: [],
  connectionModes: { httpUrl: null, stdioCommand: 'lnwjud-mcp-stdio.cmd' },
  workLog: [],
  inFlight: [],
  tunnel: { state: 'stopped', source: 'desktop', hasApiKey: false, clientPath: null, profileExists: false, message: null, logPath: null },
  appVersion: '4.6.1',
};

function render(dashboard: DashboardSnapshot, locale: 'th' | 'en' = 'en'): string {
  return renderToStaticMarkup(createElement(ControlCenterPage, {
    dashboard,
    locale,
    workspaces: [],
    mcpBusy: false,
    tunnelBusy: false,
    onRefresh: async () => undefined,
    onStopMcp: async () => undefined,
    onRestartMcp: async () => undefined,
    onSelectWorkspace: async () => undefined,
    onAddWorkspace: async () => undefined,
    onStartTunnel: async () => undefined,
    onStopTunnel: async () => undefined,
    onCaptureIncident: async () => undefined,
    incidentBusy: false,
    incidentClassification: null,
    incidentCapturedAt: null,
    incidentNotice: null,
  }));
}

describe('Security Overview', () => {
  it('shows a restricted posture when STDIO uses strict roots and risky switches are off', () => {
    const markup = render(baseDashboard);
    expect(markup).toContain('Security Overview');
    expect(markup).toContain('Restricted scope');
    expect(markup).toContain('BALANCED');
    expect(markup).toContain('Allowed Roots');
    expect(markup).not.toContain('registered machine roots may be visible');
  });

  it('warns when Secure Tunnel / STDIO has broad full access without Strict Roots', () => {
    const markup = render({
      ...baseDashboard,
      stdioPermissionProfile: 'full',
      stdioStrictRoots: false,
      stdioAllowedRoots: [],
      unrestricted: true,
      allowAiDelete: true,
    });
    expect(markup).toContain('Broad access');
    expect(markup).toContain('registered machine roots may be visible');
    expect(markup).toContain('AI File Delete');
  });

  it('localizes the security summary to Thai', () => {
    const markup = render({ ...baseDashboard, locale: 'th' }, 'th');
    expect(markup).toContain('ภาพรวมความปลอดภัย');
    expect(markup).toContain('จำกัดขอบเขตแล้ว');
    expect(markup).toContain('Strict Roots จำกัดเฉพาะ Secure Tunnel / STDIO');
  });
});
