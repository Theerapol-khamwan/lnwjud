import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { DashboardSnapshot } from '@lnwjud/ipc-contracts';
import { SettingsPage } from '../src/renderer/features/settings/SettingsPage.js';

const noop = async (): Promise<void> => undefined;
const dashboard: DashboardSnapshot = {
  selectedWorkspace: null,
  gitSummary: { branch: null, changedFiles: 0, stagedFiles: 0, message: '' },
  mcp: { running: false, url: null, workspaceId: null },
  codex: { installed: false, version: null },
  managedProcessCount: 0,
  auditEventCount: 0,
  recentAuditEvents: [],
  permissionProfile: 'safe',
  capabilities: [],
  agentState: 'stopped',
  mode: 'WORK',
  locale: 'en',
  unrestricted: false,
  allowAiDelete: false,
  stdioPermissionProfile: 'full',
  stdioStrictRoots: false,
  stdioAllowedRoots: [],
  backups: [{ id: 'backup-2026-08-22T00-00-00-000Z-deadbeef', createdAt: '2026-08-22T00:00:00.000Z', reason: 'daily', sizeBytes: 4096 }],
  connectionModes: { httpUrl: null, stdioCommand: 'lnwjud --mcp-stdio' },
  workLog: [],
  inFlight: [],
  tunnel: { state: 'stopped', source: 'desktop', hasApiKey: false, clientPath: null, profileExists: false, message: null, logPath: null },
  appVersion: '4.5.0',
};

describe('Backup settings UI', () => {
  it('shows consistent backup controls and an available restore action', () => {
    const markup = renderToStaticMarkup(createElement(SettingsPage, {
      locale: 'en',
      dashboard,
      onLocaleChange: noop,
      onPermissionProfileChange: noop,
      onUnrestrictedChange: async (): Promise<boolean> => false,
      onAiDeleteChange: noop,
      onStdioPolicyChange: async (): Promise<boolean> => false,
      onCreateBackup: noop,
      onScheduleRestoreBackup: async (): Promise<boolean> => true,
      onSaveTunnelApiKey: noop,
      onSetTunnelClientPath: noop,
    }));

    expect(markup).toContain('Backup &amp; Restore');
    expect(markup).toContain('Backup Now');
    expect(markup).toContain('SQLite consistent snapshots');
    expect(markup).toContain('Restore</button>');
  });

  it('disables restore while local MCP or Secure Tunnel is active', () => {
    const markup = renderToStaticMarkup(createElement(SettingsPage, {
      locale: 'en',
      dashboard: { ...dashboard, mcp: { running: true, url: 'http://127.0.0.1:18765/mcp', workspaceId: null } },
      onLocaleChange: noop,
      onPermissionProfileChange: noop,
      onUnrestrictedChange: async (): Promise<boolean> => false,
      onAiDeleteChange: noop,
      onStdioPolicyChange: async (): Promise<boolean> => false,
      onCreateBackup: noop,
      onScheduleRestoreBackup: async (): Promise<boolean> => true,
      onSaveTunnelApiKey: noop,
      onSetTunnelClientPath: noop,
    }));

    expect(markup).toContain('Stop Tunnel and local MCP before scheduling a restore.');
    expect(markup).toContain('<button type="button" disabled="">Restore</button>');
  });
});
