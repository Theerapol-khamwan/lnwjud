import { describe, expect, it } from 'vitest';
import { en, th, type MessageKey } from '../src/renderer/i18n/messages.js';
import { createTranslator } from '../src/renderer/i18n/index.js';

describe('i18n translations', () => {
  it('has identical keys in both Thai and English message maps', () => {
    const thKeys = Object.keys(th).sort();
    const enKeys = Object.keys(en).sort();
    expect(thKeys).toEqual(enKeys);
  });

  it('translates all required error, loading, and permission keys', () => {
    const tTh = createTranslator('th');
    const tEn = createTranslator('en');

    const requiredKeys: MessageKey[] = [
      'app.loading',
      'error.logBufferClear',
      'error.logExport',
      'error.logViewerOpen',
      'error.desktopService',
      'error.workspaceAdd',
      'error.workspaceSelect',
      'error.permissionProfileChange',
      'error.unrestrictedModeChange',
      'error.mcpStop',
      'error.mcpRestart',
      'error.workLogClear',
      'error.tunnelStart',
      'error.tunnelStop',
      'error.doctorRun',
      'git.changed',
      'git.staged',
      'doctor.noReport',
      'permission.safe',
      'permission.balanced',
      'permission.full',
      'permission.custom',
      'settings.saved',
    ];

    for (const key of requiredKeys) {
      expect(tTh(key)).toBeTruthy();
      expect(tEn(key)).toBeTruthy();
      expect(tTh(key)).not.toBe(tEn(key));
    }
  });
});
