import type { SettingsSection } from '../settings/SettingsPage.js';

export type RemediationNavigation =
  | { readonly screen: 'projects' }
  | { readonly screen: 'settings'; readonly section: SettingsSection };

const SETTINGS_TARGETS: Readonly<Record<string, SettingsSection>> = Object.freeze({
  general: 'general',
  security: 'security',
  tools: 'tools',
  mcp: 'mcp',
  extensions: 'mcp',
  tunnel: 'tunnel',
  backup: 'backup',
});

export function remediationNavigationForTarget(target: string): RemediationNavigation | null {
  if (target === 'projects') return { screen: 'projects' };
  const section = SETTINGS_TARGETS[target];
  return section === undefined ? null : { screen: 'settings', section };
}
