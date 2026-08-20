import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createTrayMenuTemplate, shouldHideMainWindowOnClose } from '../src/main/tray.js';

describe('desktop tray behavior', () => {
  it('exposes open, update, and quit actions in the context menu', () => {
    const actions = {
      openMainWindow: vi.fn(),
      checkForUpdates: vi.fn(),
      quit: vi.fn(),
    };
    const menu = createTrayMenuTemplate(actions);

    expect(menu.map((item) => item.type === 'separator' ? 'separator' : item.label)).toEqual([
      'เปิดหน้า',
      'ตรวจอัปเดต',
      'separator',
      'ปิดโปรแกรม',
    ]);

    menu[0]?.click?.();
    menu[1]?.click?.();
    menu[3]?.click?.();
    expect(actions.openMainWindow).toHaveBeenCalledOnce();
    expect(actions.checkForUpdates).toHaveBeenCalledOnce();
    expect(actions.quit).toHaveBeenCalledOnce();
  });

  it('hides on a normal close but allows an intentional quit', () => {
    expect(shouldHideMainWindowOnClose(false)).toBe(true);
    expect(shouldHideMainWindowOnClose(true)).toBe(false);
  });
  it('gives manual tray checks explicit feedback when the installed version is already current', async () => {
    const source = await readFile(path.resolve(import.meta.dirname, '..', 'src', 'main', 'main.ts'), 'utf8');
    expect(source).toContain("autoUpdater.on('update-not-available'");
    expect(source).toContain('เป็นเวอร์ชันล่าสุดแล้ว');
  });

});
