import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BrowserWindow } from 'electron';

const mainDirectory = path.dirname(fileURLToPath(import.meta.url));

export function getPreloadPath(): string {
  return path.resolve(mainDirectory, '..', 'preload', 'index.cjs');
}

export function getRendererEntryPath(): string {
  return path.resolve(mainDirectory, '..', 'renderer', 'index.html');
}

export function isAllowedRendererUrl(navigationUrl: string, rendererEntryPath: string): boolean {
  try {
    const parsedUrl = new URL(navigationUrl);
    if (parsedUrl.protocol !== 'file:') return false;
    const requestedPath = path.normalize(fileURLToPath(parsedUrl)).toLowerCase();
    const allowedPath = path.normalize(rendererEntryPath).toLowerCase();
    return requestedPath === allowedPath;
  } catch {
    return false;
  }
}

export function createMainWindow(): BrowserWindow {
  const rendererEntryPath = getRendererEntryPath();
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    webPreferences: {
      preload: getPreloadPath(),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, navigationUrl) => {
    if (!isAllowedRendererUrl(navigationUrl, rendererEntryPath)) event.preventDefault();
  });
  mainWindow.webContents.on('will-attach-webview', (event) => {
    event.preventDefault();
  });
  mainWindow.once('ready-to-show', () => mainWindow.show());
  void mainWindow.loadFile(rendererEntryPath);
  return mainWindow;
}
