import type { ReactElement, ReactNode } from 'react';
import type { UiLocale } from '@lnwjud/ipc-contracts';
import { createTranslator } from '../../i18n/index.js';
import type { MessageKey } from '../../i18n/messages.js';

export type Screen = 'home' | 'projects' | 'git' | 'worklog' | 'live' | 'settings' | 'doctor';

interface AppShellProps {
  readonly locale: UiLocale;
  readonly appVersion: string;
  readonly mcpRunning: boolean;
  readonly screen: Screen;
  readonly onNavigate: (screen: Screen) => void;
  readonly onLocaleChange: (locale: UiLocale) => void;
  readonly children: ReactNode;
}

const navItems: ReadonlyArray<{ readonly screen: Screen; readonly key: MessageKey }> = [
  { screen: 'home', key: 'nav.home' },
  { screen: 'projects', key: 'nav.projects' },
  { screen: 'git', key: 'nav.git' },
  { screen: 'worklog', key: 'nav.workLog' },
  { screen: 'live', key: 'nav.live' },
  { screen: 'settings', key: 'nav.settings' },
  { screen: 'doctor', key: 'nav.doctor' },
];

export function AppShell(props: AppShellProps): ReactElement {
  const t = createTranslator(props.locale);
  return (
    <div className="window-container">
      {/* Modern Luxury Dark Gold Titlebar */}
      <header className="custom-titlebar">
        <div className="titlebar-drag-region">
          <div className="titlebar-brand">
            <img src="./favicon.ico" alt="lnwjud logo" className="titlebar-logo" />
            <span className="titlebar-title">{t('brand')}</span>
            <span className="titlebar-version">v{props.appVersion}</span>
          </div>

          <div className="titlebar-center">
            <div className="titlebar-status-indicator">
              <span className={`titlebar-dot ${props.mcpRunning ? 'active' : ''}`}></span>
              <span>{props.mcpRunning ? (props.locale === 'th' ? 'MCP Gateway ออนไลน์' : 'MCP Gateway Active') : (props.locale === 'th' ? 'MCP พร้อมทำงาน' : 'MCP Ready')}</span>
            </div>
          </div>
        </div>

        <div className="titlebar-actions">
          <div className="locale-switch" role="group" aria-label={t('settings.locale')}>
            <button
              type="button"
              className={props.locale === 'th' ? 'active' : undefined}
              onClick={() => props.onLocaleChange('th')}
            >
              {t('language.th')}
            </button>
            <button
              type="button"
              className={props.locale === 'en' ? 'active' : undefined}
              onClick={() => props.onLocaleChange('en')}
            >
              {t('language.en')}
            </button>
          </div>
        </div>
      </header>

      {/* Main App Body */}
      <div className="app-shell">
        <aside className="sidebar" aria-label="Navigation">
          <div className="sidebar-brand">
            <strong>{t('brand')}</strong>
            <span>v{props.appVersion}</span>
          </div>
          <nav className="sidebar-nav">
            {navItems.map((item) => (
              <button
                key={item.screen}
                type="button"
                className={props.screen === item.screen ? 'nav-item active' : 'nav-item'}
                onClick={() => props.onNavigate(item.screen)}
              >
                {t(item.key)}
              </button>
            ))}
          </nav>
          <div className="sidebar-footer">
            <span>Windows Desktop</span>
            <strong className={props.mcpRunning ? 'status-online' : 'status-offline'}>
              {props.mcpRunning ? t('footer.connected') : t('footer.disconnected')}
            </strong>
          </div>
        </aside>

        <div className="main-pane">
          <main className="main-content">{props.children}</main>
        </div>
      </div>
    </div>
  );
}
