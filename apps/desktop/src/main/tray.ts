import type { MenuItemConstructorOptions } from 'electron';

export interface TrayMenuActions {
  readonly openMainWindow: () => void;
  readonly checkForUpdates: () => void;
  readonly updateLabel?: string;
  readonly quit: () => void;
}

export function createTrayMenuTemplate(actions: TrayMenuActions): MenuItemConstructorOptions[] {
  return [
    { label: 'เปิดหน้า', click: actions.openMainWindow },
    { label: actions.updateLabel ?? 'ตรวจอัปเดต', click: actions.checkForUpdates },
    { type: 'separator' },
    { label: 'ปิดโปรแกรม', click: actions.quit },
  ];
}

export function shouldHideMainWindowOnClose(quitRequested: boolean): boolean {
  return !quitRequested;
}
