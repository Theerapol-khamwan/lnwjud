import type { MenuItemConstructorOptions } from 'electron';
import type { CloseBehavior, UiLocale, UpdateStatus } from '@lnwjud/ipc-contracts';
import { nativeMessages } from './native-i18n.js';

export interface TrayMenuActions {
  readonly locale: UiLocale;
  readonly openMainWindow: () => void;
  readonly checkForUpdates: () => void;
  readonly updateLabel?: string;
  readonly quit: () => void;
}

export function createTrayMenuTemplate(actions: TrayMenuActions): MenuItemConstructorOptions[] {
  const labels = nativeMessages(actions.locale);
  return [
    { label: labels.trayOpen, click: actions.openMainWindow },
    { label: actions.updateLabel ?? labels.trayCheckUpdates, click: actions.checkForUpdates },
    { type: 'separator' },
    { label: labels.trayQuit, click: actions.quit },
  ];
}

export function createTrayUpdateLabel(status: UpdateStatus, locale: UiLocale): string {
  const messages = nativeMessages(locale);
  const version = status.availableVersion;
  if (status.phase === 'ready' && version !== null) return messages.trayInstall(version);
  if (status.phase === 'installing' && version !== null) return messages.trayPreparing(version);
  if (status.phase === 'downloading' && version !== null) return messages.trayDownloading(version, status.progressPercent);
  if (status.phase === 'checking') return messages.updaterChecking;
  return messages.trayCheckUpdates;
}

export function createTrayToolTip(locale: UiLocale): string {
  return nativeMessages(locale).trayTooltip;
}

export function shouldHideMainWindowOnClose(quitRequested: boolean, closeBehavior: CloseBehavior = 'tray'): boolean {
  return !quitRequested && closeBehavior === 'tray';
}
