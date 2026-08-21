import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, Tray, type IpcMainInvokeEvent } from 'electron';
import path from 'node:path';
import { access } from 'node:fs/promises';
import { autoUpdater } from 'electron-updater';
import {
  APP_NAME,
  APP_VERSION,
  ipcChannels,
  pushChannels,
  type AddWorkspaceRequest,
  type BackupSummary,
  type ClearLogBufferRequest,
  type DashboardSnapshot,
  type DoctorReport,
  type ExportLogsRequest,
  type IpcResponseMap,
  type LogSnapshot,
  type ManagedBrowserStatus,
  type McpConnectionStatus,
  type ProcessSummary,
  type PermissionProfileName,
  type SaveTunnelApiKeyRequest,
  type ScheduleRestoreBackupRequest,
  type SelectWorkspaceRequest,
  type SetAiDeletePolicyRequest,
  type SetLocaleRequest,
  type SetPermissionProfileRequest,
  type SetStdioPolicyRequest,
  type SetTunnelClientPathRequest,
  type SetUnrestrictedModeRequest,
  type StartMcpRequest,
  type StartProcessRequest,
  type StopProcessRequest,
  type TunnelStatus,
  type UiLocale,
  type WorkspaceSummary,
} from '@lnwjud/ipc-contracts';
import { readSharedActivitySnapshot, startMcpStdio } from '@lnwjud/mcp-server';
import { resolveLnwjudDataPath } from '@lnwjud/shared';
import { applyPendingSqliteRestoreSync } from '@lnwjud/storage';
import { createDesktopRuntime, type DesktopRuntime } from './desktop-services.js';
import { DesktopShutdownCoordinator } from './desktop-shutdown.js';
import { shouldHoldSingleInstanceLock, wantsMcpStdio } from './instance-lock.js';
import { createLogViewerWindow, createMainWindow, getRendererEntryPath, getWindowIconPath, isAllowedRendererUrl } from './window.js';
import { createTrayMenuTemplate, shouldHideMainWindowOnClose } from './tray.js';
import { UpdateDownloadedDialogController, UpdateInstallCoordinator, type UpdateSharedActivitySnapshot } from './update-install.js';
import { atomicWrite, type IncidentReport } from './incident-report.js';
import { IncidentSaveCoordinator } from './incident-save.js';

export interface DesktopIpcServices {
  listWorkspaces(): Promise<IpcResponseMap[typeof ipcChannels.listWorkspaces]>;
  addWorkspace(request: AddWorkspaceRequest): Promise<WorkspaceSummary>;
  selectWorkspace(request: SelectWorkspaceRequest): Promise<WorkspaceSummary>;
  getDashboard(): Promise<DashboardSnapshot>;
  setPermissionProfile(request: SetPermissionProfileRequest): Promise<{ readonly profile: PermissionProfileName }>;
  setUnrestrictedMode(request: SetUnrestrictedModeRequest): Promise<{ readonly unrestricted: boolean; readonly restartRequired: boolean }>;
  setAiDeletePolicy(request: SetAiDeletePolicyRequest): Promise<{ readonly enabled: boolean }>;
  setStdioPolicy(request: SetStdioPolicyRequest): Promise<{ readonly profile: PermissionProfileName; readonly strictRoots: boolean; readonly allowedRoots: readonly string[]; readonly restartRequired: boolean }>;
  createBackup(): Promise<BackupSummary>;
  scheduleRestoreBackup(request: ScheduleRestoreBackupRequest): Promise<{ readonly scheduled: boolean; readonly restartRequired: boolean }>;
  listProcesses(): Promise<IpcResponseMap[typeof ipcChannels.listProcesses]>;
  startProcess(request: StartProcessRequest): Promise<IpcResponseMap[typeof ipcChannels.startProcess]>;
  stopProcess(request: StopProcessRequest): Promise<{ readonly stopped: boolean }>;
  startMcp(request: StartMcpRequest): Promise<McpConnectionStatus>;
  stopMcp(): Promise<McpConnectionStatus>;
  restartMcp(): Promise<McpConnectionStatus>;
  clearWorkLog(): Promise<{ readonly cleared: boolean }>;
  saveTunnelApiKey(request: SaveTunnelApiKeyRequest): Promise<{ readonly saved: boolean }>;
  startTunnel(): Promise<TunnelStatus>;
  stopTunnel(): Promise<TunnelStatus>;
  getTunnelStatus(): Promise<TunnelStatus>;
  setTunnelClientPath(request: SetTunnelClientPathRequest): Promise<{ readonly clientPath: string }>;
  setLocale(request: SetLocaleRequest): Promise<{ readonly locale: UiLocale }>;
  launchManagedBrowser(): Promise<ManagedBrowserStatus>;
  runDoctor(): Promise<DoctorReport>;
  getLogSnapshot(): Promise<LogSnapshot>;
  clearLogBuffer(request: ClearLogBufferRequest): Promise<{ readonly cleared: boolean }>;
  captureIncident(updaterEvents?: readonly string[]): Promise<IncidentReport>;
}

export type MainWindowProvider = () => BrowserWindow | null;

const emptyTunnel: TunnelStatus = {
  state: 'stopped',
  source: 'desktop',
  hasApiKey: false,
  clientPath: null,
  profileExists: false,
  message: null,
  logPath: null,
};

const defaultDesktopServices: DesktopIpcServices = {
  listWorkspaces: async (): Promise<readonly WorkspaceSummary[]> => [],
  addWorkspace: async (): Promise<WorkspaceSummary> => {
    throw new Error('Workspace service is not configured');
  },
  selectWorkspace: async (): Promise<WorkspaceSummary> => {
    throw new Error('Workspace service is not configured');
  },
  getDashboard: async (): Promise<DashboardSnapshot> => ({
    selectedWorkspace: null,
    gitSummary: { branch: null, changedFiles: 0, stagedFiles: 0, message: 'No workspace selected' },
    mcp: { running: false, url: null, workspaceId: null },
    codex: { installed: false, version: null },
    managedProcessCount: 0,
    auditEventCount: 0,
    recentAuditEvents: [],
    permissionProfile: 'safe',
    capabilities: [],
    agentState: 'stopped',
    mode: 'WORK',
    locale: 'th',
    unrestricted: false,
    allowAiDelete: false,
    stdioPermissionProfile: 'full',
    stdioStrictRoots: false,
    stdioAllowedRoots: [],
    backups: [],
    connectionModes: { httpUrl: null, stdioCommand: 'lnwjud.exe --mcp-stdio' },
    workLog: [],
    inFlight: [],
    tunnel: emptyTunnel,
    appVersion: APP_VERSION,
  }),
  setPermissionProfile: async (request): Promise<{ readonly profile: PermissionProfileName }> => ({ profile: request.profile }),
  setUnrestrictedMode: async (request): Promise<{ readonly unrestricted: boolean; readonly restartRequired: boolean }> => ({
    unrestricted: request.enabled,
    restartRequired: false,
  }),
  setAiDeletePolicy: async (request): Promise<{ readonly enabled: boolean }> => ({ enabled: request.enabled }),
  setStdioPolicy: async (request): Promise<{ readonly profile: PermissionProfileName; readonly strictRoots: boolean; readonly allowedRoots: readonly string[]; readonly restartRequired: boolean }> => ({
    profile: request.profile, strictRoots: request.strictRoots, allowedRoots: request.allowedRoots, restartRequired: false,
  }),
  createBackup: async (): Promise<BackupSummary> => ({ id: 'unavailable', createdAt: new Date(0).toISOString(), reason: 'manual', sizeBytes: 0 }),
  scheduleRestoreBackup: async (): Promise<{ readonly scheduled: boolean; readonly restartRequired: boolean }> => ({ scheduled: false, restartRequired: false }),
  listProcesses: async (): Promise<readonly ProcessSummary[]> => [],
  startProcess: async (): Promise<IpcResponseMap[typeof ipcChannels.startProcess]> => {
    throw new Error('Desktop services are not configured');
  },
  stopProcess: async (): Promise<{ readonly stopped: boolean }> => ({ stopped: false }),
  startMcp: async (): Promise<McpConnectionStatus> => ({ running: false, url: null, workspaceId: null }),
  stopMcp: async (): Promise<McpConnectionStatus> => ({ running: false, url: null, workspaceId: null }),
  restartMcp: async (): Promise<McpConnectionStatus> => ({ running: false, url: null, workspaceId: null }),
  clearWorkLog: async (): Promise<{ readonly cleared: boolean }> => ({ cleared: false }),
  saveTunnelApiKey: async (): Promise<{ readonly saved: boolean }> => ({ saved: false }),
  startTunnel: async (): Promise<TunnelStatus> => emptyTunnel,
  stopTunnel: async (): Promise<TunnelStatus> => emptyTunnel,
  getTunnelStatus: async (): Promise<TunnelStatus> => emptyTunnel,
  setTunnelClientPath: async (request): Promise<{ readonly clientPath: string }> => ({ clientPath: request.clientPath }),
  setLocale: async (request): Promise<{ readonly locale: UiLocale }> => ({ locale: request.locale }),
  launchManagedBrowser: async (): Promise<ManagedBrowserStatus> => ({ ready: false, port: 9222, launched: false }),
  runDoctor: async (): Promise<DoctorReport> => ({
    checks: [{ id: 'desktop', required: true, status: 'fail', message: 'Desktop services are not configured' }],
    exitCode: 1,
  }),
  getLogSnapshot: async (): Promise<LogSnapshot> => ({
    lines: [],
    tunnelLogPath: null,
    tunnelLogExists: false,
  }),
  clearLogBuffer: async (): Promise<{ readonly cleared: boolean }> => ({ cleared: false }),
  captureIncident: async (): Promise<IncidentReport> => ({ schemaVersion: 1, capturedAt: new Date().toISOString(), appVersion: APP_VERSION, tunnelClientVersion: null, tunnelClientVersionReason: 'desktop_services_unavailable', classification: 'healthy_or_inconclusive', classificationReasons: ['desktop_services_unavailable'], updaterEventTail: [], tunnel: { state: 'stopped', source: 'desktop', instanceIds: [], requestIds: [], health: { state: 'unavailable', message: 'unavailable' } }, mcpCalls: [], tunnelLogTail: [], processTree: { available: false, entries: [], error: 'unavailable' }, tcpListeners: { available: false, entries: [], error: 'unavailable' } }),
};

const updaterEventTail: string[] = [];
function recordUpdaterEvent(message: string): void { updaterEventTail.push(message.slice(0, 512)); while (updaterEventTail.length > 100) updaterEventTail.shift(); }
const recordedUpdaterDownloads = new Set<string>();
function recordUpdaterDownload(version: string): void {
  if (recordedUpdaterDownloads.has(version)) return;
  recordedUpdaterDownloads.add(version);
  recordUpdaterEvent(`update-downloaded:${version}`);
}

export function isTrustedIpcSender(event: IpcMainInvokeEvent, window: BrowserWindow | null): boolean {
  void window;
  const senderFrame = event.senderFrame;
  return senderFrame !== null && isAllowedRendererUrl(senderFrame.url, getRendererEntryPath());
}

export function registerIpcHandlers(
  getMainWindow: MainWindowProvider,
  services: DesktopIpcServices = defaultDesktopServices,
): void {
  const incidentSaver = new IncidentSaveCoordinator({
    capture: (): Promise<IncidentReport> => services.captureIncident(updaterEventTail),
    choosePath: async (): Promise<string | null> => {
      const window = getMainWindow();
      if (window === null) return null;
      const result = await dialog.showSaveDialog(window, { title: 'Capture lnwjud incident evidence', defaultPath: 'lnwjud-incident.json', filters: [{ name: 'JSON', extensions: ['json'] }] });
      return result.canceled || result.filePath === undefined || result.filePath.length === 0 ? null : result.filePath;
    },
    write: atomicWrite,
  });
  ipcMain.handle(ipcChannels.listWorkspaces, async (event, payload: unknown) => {
    assertTrustedSender(event, getMainWindow());
    assertNoPayload(payload);
    return services.listWorkspaces();
  });
  ipcMain.handle(ipcChannels.addWorkspace, async (event, payload: unknown) => {
    assertTrustedSender(event, getMainWindow());
    return services.addWorkspace(parseAddWorkspaceRequest(payload));
  });
  ipcMain.handle(ipcChannels.selectWorkspace, async (event, payload: unknown) => {
    assertTrustedSender(event, getMainWindow());
    return services.selectWorkspace(parseSelectWorkspaceRequest(payload));
  });
  ipcMain.handle(ipcChannels.getDashboard, async (event, payload: unknown) => {
    assertTrustedSender(event, getMainWindow());
    assertNoPayload(payload);
    return services.getDashboard();
  });
  ipcMain.handle(ipcChannels.setPermissionProfile, async (event, payload: unknown) => {
    assertTrustedSender(event, getMainWindow());
    return services.setPermissionProfile(parseSetPermissionProfileRequest(payload));
  });
  ipcMain.handle(ipcChannels.setUnrestrictedMode, async (event, payload: unknown) => {
    assertTrustedSender(event, getMainWindow());
    return services.setUnrestrictedMode(parseSetUnrestrictedModeRequest(payload));
  });
  ipcMain.handle(ipcChannels.setAiDeletePolicy, async (event, payload: unknown) => {
    assertTrustedSender(event, getMainWindow());
    return services.setAiDeletePolicy(parseSetAiDeletePolicyRequest(payload));
  });
  ipcMain.handle(ipcChannels.setStdioPolicy, async (event, payload: unknown) => {
    assertTrustedSender(event, getMainWindow());
    return services.setStdioPolicy(parseSetStdioPolicyRequest(payload));
  });
  ipcMain.handle(ipcChannels.createBackup, async (event, payload: unknown) => {
    assertTrustedSender(event, getMainWindow());
    assertNoPayload(payload);
    return services.createBackup();
  });
  ipcMain.handle(ipcChannels.scheduleRestoreBackup, async (event, payload: unknown) => {
    assertTrustedSender(event, getMainWindow());
    return services.scheduleRestoreBackup(parseScheduleRestoreBackupRequest(payload));
  });
  ipcMain.handle(ipcChannels.listProcesses, async (event, payload: unknown) => {
    assertTrustedSender(event, getMainWindow());
    assertNoPayload(payload);
    return services.listProcesses();
  });
  ipcMain.handle(ipcChannels.startProcess, async (event, payload: unknown) => {
    assertTrustedSender(event, getMainWindow());
    return services.startProcess(parseStartProcessRequest(payload));
  });
  ipcMain.handle(ipcChannels.stopProcess, async (event, payload: unknown) => {
    assertTrustedSender(event, getMainWindow());
    return services.stopProcess(parseStopProcessRequest(payload));
  });
  ipcMain.handle(ipcChannels.startMcp, async (event, payload: unknown) => {
    assertTrustedSender(event, getMainWindow());
    return services.startMcp(parseStartMcpRequest(payload));
  });
  ipcMain.handle(ipcChannels.stopMcp, async (event, payload: unknown) => {
    assertTrustedSender(event, getMainWindow());
    assertNoPayload(payload);
    return services.stopMcp();
  });
  ipcMain.handle(ipcChannels.restartMcp, async (event, payload: unknown) => {
    assertTrustedSender(event, getMainWindow());
    assertNoPayload(payload);
    return services.restartMcp();
  });
  ipcMain.handle(ipcChannels.clearWorkLog, async (event, payload: unknown) => {
    assertTrustedSender(event, getMainWindow());
    assertNoPayload(payload);
    return services.clearWorkLog();
  });
  ipcMain.handle(ipcChannels.saveTunnelApiKey, async (event, payload: unknown) => {
    assertTrustedSender(event, getMainWindow());
    return services.saveTunnelApiKey(parseSaveTunnelApiKeyRequest(payload));
  });
  ipcMain.handle(ipcChannels.startTunnel, async (event, payload: unknown) => {
    assertTrustedSender(event, getMainWindow());
    assertNoPayload(payload);
    return services.startTunnel();
  });
  ipcMain.handle(ipcChannels.stopTunnel, async (event, payload: unknown) => {
    assertTrustedSender(event, getMainWindow());
    assertNoPayload(payload);
    return services.stopTunnel();
  });
  ipcMain.handle(ipcChannels.getTunnelStatus, async (event, payload: unknown) => {
    assertTrustedSender(event, getMainWindow());
    assertNoPayload(payload);
    return services.getTunnelStatus();
  });
  ipcMain.handle(ipcChannels.setTunnelClientPath, async (event, payload: unknown) => {
    assertTrustedSender(event, getMainWindow());
    return services.setTunnelClientPath(parseSetTunnelClientPathRequest(payload));
  });
  ipcMain.handle(ipcChannels.setLocale, async (event, payload: unknown) => {
    assertTrustedSender(event, getMainWindow());
    return services.setLocale(parseSetLocaleRequest(payload));
  });
  ipcMain.handle(ipcChannels.launchManagedBrowser, async (event, payload: unknown) => {
    assertTrustedSender(event, getMainWindow());
    assertNoPayload(payload);
    return services.launchManagedBrowser();
  });
  ipcMain.handle(ipcChannels.runDoctor, async (event, payload: unknown) => {
    assertTrustedSender(event, getMainWindow());
    assertNoPayload(payload);
    return services.runDoctor();
  });
  ipcMain.handle(ipcChannels.getLogSnapshot, async (event, payload: unknown) => {
    assertTrustedSender(event, getMainWindow());
    assertNoPayload(payload);
    return services.getLogSnapshot();
  });
  ipcMain.handle(ipcChannels.clearLogBuffer, async (event, payload: unknown) => {
    assertTrustedSender(event, getMainWindow());
    return services.clearLogBuffer(parseClearLogBufferRequest(payload));
  });
  ipcMain.handle(ipcChannels.exportLogs, async (event, payload: unknown) => {
    assertTrustedSender(event, getMainWindow());
    return exportLogsToFile(getMainWindow(), services, parseExportLogsRequest(payload));
  });
  ipcMain.handle(ipcChannels.captureIncident, async (event, payload: unknown) => {
    assertTrustedSender(event, getMainWindow());
    assertNoPayload(payload);
    return incidentSaver.captureAndSave();
  });
  ipcMain.handle(ipcChannels.openLogViewer, async (event, payload: unknown) => {
    assertTrustedSender(event, getMainWindow());
    assertNoPayload(payload);
    return { opened: openLogViewerWindow() !== null };
  });
}

function assertTrustedSender(event: IpcMainInvokeEvent, mainWindow: BrowserWindow | null): void {
  if (mainWindow === null || !isTrustedIpcSender(event, mainWindow)) throw new Error('IPC sender rejected');
}

function assertNoPayload(payload: unknown): void {
  if (payload !== undefined) throw new Error('Invalid IPC payload');
}

function parseAddWorkspaceRequest(payload: unknown): AddWorkspaceRequest {
  if (!isRecord(payload)) throw new Error('Invalid IPC payload');
  return { rootPath: nonEmptyString(payload.rootPath, 'rootPath') };
}

function parseSelectWorkspaceRequest(payload: unknown): SelectWorkspaceRequest {
  if (!isRecord(payload)) throw new Error('Invalid IPC payload');
  return { workspaceId: nonEmptyString(payload.workspaceId, 'workspaceId') };
}

function parseSetPermissionProfileRequest(payload: unknown): SetPermissionProfileRequest {
  if (!isRecord(payload) || !isPermissionProfile(payload.profile)) throw new Error('Invalid IPC payload');
  return { profile: payload.profile };
}

function parseSetUnrestrictedModeRequest(payload: unknown): SetUnrestrictedModeRequest {
  if (!isRecord(payload) || typeof payload.enabled !== 'boolean') throw new Error('Invalid IPC payload: enabled');
  return { enabled: payload.enabled };
}

function parseSetAiDeletePolicyRequest(payload: unknown): SetAiDeletePolicyRequest {
  if (!isRecord(payload) || typeof payload.enabled !== 'boolean') throw new Error('Invalid IPC payload: enabled');
  return { enabled: payload.enabled };
}

function parseScheduleRestoreBackupRequest(payload: unknown): ScheduleRestoreBackupRequest {
  if (!isRecord(payload)) throw new Error('Invalid IPC payload');
  return { backupId: nonEmptyString(payload.backupId, 'backupId') };
}

function parseSetStdioPolicyRequest(payload: unknown): SetStdioPolicyRequest {
  if (!isRecord(payload) || !isPermissionProfile(payload.profile) || typeof payload.strictRoots !== 'boolean' || !Array.isArray(payload.allowedRoots)) {
    throw new Error('Invalid IPC payload: stdio policy');
  }
  const allowedRoots = payload.allowedRoots.map((root) => nonEmptyString(root, 'allowedRoot').trim());
  if (payload.strictRoots && allowedRoots.length === 0) throw new Error('Strict root mode requires at least one allowed root');
  return { profile: payload.profile, strictRoots: payload.strictRoots, allowedRoots };
}

function parseClearLogBufferRequest(payload: unknown): ClearLogBufferRequest {
  if (!isRecord(payload) || !isLogSource(payload.source)) throw new Error('Invalid IPC payload: source');
  return { source: payload.source };
}

function parseExportLogsRequest(payload: unknown): ExportLogsRequest {
  if (!isRecord(payload) || !isLogSource(payload.source)) {
    throw new Error('Invalid IPC payload');
  }
  return {
    source: payload.source,
    filePath: typeof payload.filePath === 'string' ? payload.filePath : '',
  };
}

function isLogSource(value: unknown): value is 'tunnel' | 'mcp' | 'process' {
  return value === 'tunnel' || value === 'mcp' || value === 'process';
}

async function exportLogsToFile(
  window: BrowserWindow | null,
  services: DesktopIpcServices,
  request: ExportLogsRequest,
): Promise<{ readonly exported: boolean }> {
  if (window === null) return { exported: false };
  const result = await dialog.showSaveDialog(window, {
    title: 'Export lnwjud logs',
    defaultPath: `lnwjud-${request.source}-logs.txt`,
    filters: [{ name: 'Text', extensions: ['txt', 'log'] }],
  });
  if (result.canceled || result.filePath === undefined || result.filePath.length === 0) {
    return { exported: false };
  }
  const snapshot = await services.getLogSnapshot();
  const content = snapshot.lines
    .filter((line) => line.source === request.source)
    .map((line) => `[${line.timestamp}] [${line.level.toUpperCase()}] ${line.text}`)
    .join('\r\n');
  await atomicWrite(result.filePath, content.length === 0 ? '' : `${content}\r\n`);
  return { exported: true };
}

function broadcastToAllWindows(channel: string, payload: unknown): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send(channel, payload);
    }
  }
}

function parseStopProcessRequest(payload: unknown): StopProcessRequest {
  if (!isRecord(payload)) throw new Error('Invalid IPC payload');
  return { processId: nonEmptyString(payload.processId, 'processId') };
}

function parseStartProcessRequest(payload: unknown): StartProcessRequest {
  if (!isRecord(payload)) throw new Error('Invalid IPC payload');
  if (!isNonEmptyString(payload.workspaceId)) throw new Error('Invalid IPC payload: workspaceId');
  if (payload.mode !== 'fixture' && payload.mode !== 'project-dev') throw new Error('Invalid IPC payload: mode');
  return { workspaceId: payload.workspaceId, mode: payload.mode };
}

function parseStartMcpRequest(payload: unknown): StartMcpRequest {
  if (!isRecord(payload) || !isNonEmptyString(payload.workspaceId)) throw new Error('Invalid IPC payload: workspaceId');
  return { workspaceId: payload.workspaceId };
}

function parseSaveTunnelApiKeyRequest(payload: unknown): SaveTunnelApiKeyRequest {
  if (!isRecord(payload)) throw new Error('Invalid IPC payload');
  return { apiKey: nonEmptyString(payload.apiKey, 'apiKey') };
}

function parseSetTunnelClientPathRequest(payload: unknown): SetTunnelClientPathRequest {
  if (!isRecord(payload)) throw new Error('Invalid IPC payload');
  return { clientPath: nonEmptyString(payload.clientPath, 'clientPath') };
}

function parseSetLocaleRequest(payload: unknown): SetLocaleRequest {
  if (!isRecord(payload) || (payload.locale !== 'th' && payload.locale !== 'en')) throw new Error('Invalid IPC payload: locale');
  return { locale: payload.locale };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`Invalid IPC payload: ${field}`);
  return value;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isPermissionProfile(value: unknown): value is PermissionProfileName {
  return value === 'safe' || value === 'balanced' || value === 'full' || value === 'custom';
}

let mainWindow: BrowserWindow | null = null;
let logViewerWindow: BrowserWindow | null = null;
let desktopRuntime: DesktopRuntime | null = null;
let tray: Tray | null = null;
let manualUpdateCheckPending = false;
let quitRequested = false;
let desktopShutdownCoordinator: DesktopShutdownCoordinator | null = null;
let updateInstallCoordinator: UpdateInstallCoordinator | null = null;
let updateDownloadedDialogController: UpdateDownloadedDialogController | null = null;

function openLogViewerWindow(): BrowserWindow | null {
  if (logViewerWindow !== null && !logViewerWindow.isDestroyed()) {
    if (logViewerWindow.isMinimized()) logViewerWindow.restore();
    logViewerWindow.show();
    logViewerWindow.focus();
    return logViewerWindow;
  }
  const viewer = createLogViewerWindow();
  logViewerWindow = viewer;
  viewer.on('closed', () => {
    logViewerWindow = null;
  });
  return viewer;
}

function createDesktopWindow(): void {
  mainWindow = createMainWindow();
  mainWindow.on('close', (event) => {
    if (!shouldHideMainWindowOnClose(quitRequested)) return;
    event.preventDefault();
    if (mainWindow !== null && !mainWindow.isDestroyed()) mainWindow.hide();
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function revealMainWindow(): void {
  if (mainWindow === null || mainWindow.isDestroyed()) {
    createDesktopWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function checkForUpdatesFromTray(): void {
  if (!app.isPackaged) {
    void dialog.showMessageBox({
      type: 'info',
      title: 'ตรวจอัปเดต',
      message: 'การตรวจอัปเดตจะทำงานเมื่อใช้แอปที่ติดตั้งจาก release แล้ว',
      buttons: ['ตกลง'],
    });
    return;
  }
  if (manualUpdateCheckPending) {
    void dialog.showMessageBox({
      type: 'info',
      title: 'ตรวจอัปเดต',
      message: 'กำลังตรวจอัปเดตอยู่ กรุณารอผลการตรวจสอบ',
      buttons: ['ตกลง'],
    });
    return;
  }
  manualUpdateCheckPending = true;
  void autoUpdater.checkForUpdates().catch((error: unknown) => {
    if (!manualUpdateCheckPending) return;
    manualUpdateCheckPending = false;
    const message = error instanceof Error ? error.message : 'ไม่สามารถตรวจอัปเดตได้';
    console.error('[AutoUpdater] tray check failed: ' + message);
    void dialog.showMessageBox({
      type: 'error',
      title: 'ตรวจอัปเดต',
      message,
      buttons: ['ตกลง'],
    });
  });
}

function createDesktopTray(): void {
  const iconPath = getWindowIconPath();
  if (iconPath === undefined) {
    console.error('lnwjud tray icon was not found');
    return;
  }
  tray?.destroy();
  tray = new Tray(nativeImage.createFromPath(iconPath));
  tray.setToolTip('lnwjud — ทำงานเบื้องหลัง');
  tray.setContextMenu(Menu.buildFromTemplate(createTrayMenuTemplate({
    openMainWindow: revealMainWindow,
    checkForUpdates: checkForUpdatesFromTray,
    quit: (): void => { app.quit(); },
  })));
  tray.on('click', revealMainWindow);
}

function destroyDesktopTray(): void {
  tray?.destroy();
  tray = null;
}

function readArgValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index < 0) return undefined;
  const value = process.argv[index + 1];
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function redirectConsoleToStderr(): void {
  const write = (stream: NodeJS.WriteStream, args: unknown[]): void => {
    stream.write(`${args.map((entry) => typeof entry === 'string' ? entry : JSON.stringify(entry)).join(' ')}\n`);
  };
  console.log = (...args: unknown[]): void => write(process.stderr, args);
  console.info = (...args: unknown[]): void => write(process.stderr, args);
  console.warn = (...args: unknown[]): void => write(process.stderr, args);
  console.error = (...args: unknown[]): void => write(process.stderr, args);
}

function bootstrapMcpStdio(): void {
  redirectConsoleToStderr();
  app.commandLine.appendSwitch('disable-gpu');
  app.commandLine.appendSwitch('disable-software-rasterizer');
  const dataPath = configureDataPath();
  void app.whenReady().then(async () => {
    const runtime = createDesktopRuntime(dataPath, { permissionProfile: 'full' });
    desktopRuntime = runtime;
    const workspacePath = readArgValue('--workspace')
      ?? process.env.LNWJUD_WORKSPACE
      ?? process.cwd();
    try {
      const workspaceId = await runtime.ensureDefaultWorkspace(workspacePath);
      process.stderr.write(`lnwjud MCP stdio ready workspace=${workspaceId}\n`);
    } catch (error: unknown) {
      process.stderr.write(`lnwjud MCP stdio workspace warning: ${error instanceof Error ? error.message : 'unknown'}\n`);
    }
    startMcpStdio({
      services: runtime.mcpServices,
      actor: runtime.mcpActor,
      activityTracker: runtime.activityTracker,
      onError: (error): void => {
        if (/EPIPE|ECONNRESET|broken pipe/i.test(error.message)) {
          process.stderr.write(`lnwjud MCP stdio: peer closed (${error.message})\n`);
          void desktopRuntime?.close().finally(() => process.exit(0));
          return;
        }
        process.stderr.write(`lnwjud MCP stdio error: ${error.message}\n`);
      },
    });
    process.stdin.on('end', () => {
      void desktopRuntime?.close().finally(() => process.exit(0));
    });
    process.stdin.on('close', () => {
      void desktopRuntime?.close().finally(() => process.exit(0));
    });
    process.stdout.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'EPIPE' || error.code === 'ECONNRESET') {
        void desktopRuntime?.close().finally(() => process.exit(0));
      }
    });
  });
  app.on('window-all-closed', () => {
    // Keep the stdio MCP process alive without a BrowserWindow.
  });
  app.on('before-quit', () => {
    void desktopRuntime?.close();
  });
}

function initAutoUpdater(runtime: DesktopRuntime): void {
  if (!app.isPackaged) return;
  try {
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = false;
    updateInstallCoordinator = new UpdateInstallCoordinator({
      activeCallCount: (): number => runtime.activityTracker.listInFlight().length,
      activityRevision: (): number => runtime.activityTracker.revision(),
      tunnelRunning: async (): Promise<boolean | 'unverifiable'> => {
        try {
          if ((await runtime.services.getTunnelStatus()).state === 'running') return true;
          try {
            await access(path.join(process.env.APPDATA ?? app.getPath('appData'), 'tunnel-client', 'lnwjud.tunnel.lock'));
            return true;
          } catch (error: unknown) {
            return typeof error === 'object' && error !== null && (error as NodeJS.ErrnoException).code === 'ENOENT' ? false : 'unverifiable';
          }
        } catch {
          return 'unverifiable';
        }
      },
      sharedActivitySnapshot: async (): Promise<UpdateSharedActivitySnapshot> => {
        const snapshot = await readSharedActivitySnapshot({ profileDirectory: path.join(process.env.APPDATA ?? app.getPath('appData'), 'tunnel-client') });
        return snapshot.state === 'available'
          ? { state: 'available', activeCallCount: snapshot.activeCount, revision: snapshot.revision, ownerKey: `${snapshot.owner.pid}:${snapshot.owner.processStartedAt}` }
          : { state: snapshot.state, reason: snapshot.reason };
      },
      install: (): void => {
        void runtime.createBackup('pre-update').catch((error: unknown) => {
          console.error(`Pre-update backup failed: ${error instanceof Error ? error.message : 'unknown error'}`);
        }).finally(() => {
          void desktopShutdownCoordinator?.requestQuit(() => autoUpdater.quitAndInstall(), 'install');
        });
      },
    });
    updateDownloadedDialogController = new UpdateDownloadedDialogController({
      showDialog: (options): Promise<{ readonly response: number }> => dialog.showMessageBox(options),
      requestInstall: (): void => updateInstallCoordinator?.requestInstall(),
      hasPendingInstall: (): boolean => updateInstallCoordinator?.hasPendingInstall() ?? false,
      onShow: (version): void => {
        console.log(`[AutoUpdater] Downloaded update: v${version}`);
        broadcastToAllWindows(pushChannels.logEvent, {
          id: Date.now(),
          timestamp: new Date().toISOString(),
          level: 'info',
          source: 'process',
          text: `[AutoUpdater] Update v${version} downloaded! Ready to install.`,
        });
      },
      onError: (error): void => {
        console.error('[AutoUpdater] update dialog error:', error instanceof Error ? error.message : String(error));
      },
    });

    autoUpdater.on('checking-for-update', () => {
      recordUpdaterEvent('checking-for-update');
      console.log('[AutoUpdater] Checking for updates on GitHub...');
    });

    autoUpdater.on('update-available', (info) => {
      recordUpdaterEvent(`update-available:${info.version}`);
      const requestedFromTray = manualUpdateCheckPending;
      manualUpdateCheckPending = false;
      console.log(`[AutoUpdater] Update available: v${info.version}`);
      if (requestedFromTray) {
        void dialog.showMessageBox({
          type: 'info',
          title: 'พบอัปเดต - lnwjud',
          message: `พบ lnwjud v${info.version} กำลังดาวน์โหลดอัปเดตในเบื้องหลัง`,
          buttons: ['ตกลง'],
        });
      }
      broadcastToAllWindows(pushChannels.logEvent, {
        id: Date.now(),
        timestamp: new Date().toISOString(),
        level: 'info',
        source: 'process',
        text: `[AutoUpdater] Version v${info.version} is available and downloading in background...`,
      });
    });

    autoUpdater.on('update-not-available', (info) => {
      recordUpdaterEvent(`update-not-available:${info.version}`);
      if (!manualUpdateCheckPending) return;
      manualUpdateCheckPending = false;
      void dialog.showMessageBox({
        type: 'info',
        title: 'ตรวจอัปเดต - lnwjud',
        message: `lnwjud v${info.version} เป็นเวอร์ชันล่าสุดแล้ว`,
        buttons: ['ตกลง'],
      });
    });

    autoUpdater.on('update-downloaded', (info) => {
      recordUpdaterDownload(info.version);
      void updateDownloadedDialogController?.handle(info.version);
    });

    autoUpdater.on('error', (err) => {
      recordUpdaterEvent(`error:${err.message}`);
      console.error('[AutoUpdater] error:', err.message);
      if (!manualUpdateCheckPending) return;
      manualUpdateCheckPending = false;
      void dialog.showMessageBox({
        type: 'error',
        title: 'ตรวจอัปเดต - lnwjud',
        message: err.message || 'ไม่สามารถตรวจอัปเดตได้',
        buttons: ['ตกลง'],
      });
    });

    setTimeout(() => {
      void autoUpdater.checkForUpdates().catch(() => {});
    }, 5000);
  } catch (err: unknown) {
    console.error('Failed to initialize auto updater:', err);
  }
}

function bootstrapDesktop(): void {
  const dataPath = configureDataPath();
  void app.whenReady().then(async () => {
    app.setAppUserModelId('com.lnwjud.desktop');
    const runtime = createDesktopRuntime(dataPath);
    desktopRuntime = runtime;
    configureDesktopShutdown(runtime);
    runtime.logHub.setOnLine((line) => broadcastToAllWindows(pushChannels.logEvent, line));
    runtime.logHub.start();
    registerIpcHandlers(() => mainWindow, runtime.services);
    try {
      await runtime.autoStartMcp();
    } catch (error: unknown) {
      console.error(`MCP auto-start failed: ${error instanceof Error ? error.message : 'unknown error'}`);
    }
    createDesktopWindow();
    createDesktopTray();
    initAutoUpdater(runtime);
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createDesktopWindow();
    });
  });
  app.on('before-quit', handleDesktopBeforeQuit);
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}

function bootstrapLogViewerOnly(): void {
  const dataPath = configureDataPath();
  void app.whenReady().then(async () => {
    app.setAppUserModelId('com.lnwjud.desktop');
    const runtime = createDesktopRuntime(dataPath);
    desktopRuntime = runtime;
    configureDesktopShutdown(runtime);
    runtime.logHub.setOnLine((line) => broadcastToAllWindows(pushChannels.logEvent, line));
    runtime.logHub.start();
    registerIpcHandlers(() => mainWindow, runtime.services);
    const viewer = openLogViewerWindow();
    if (viewer !== null) {
      mainWindow = viewer;
      viewer.on('closed', () => {
        if (mainWindow === viewer) mainWindow = null;
      });
    }
  });
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
  app.on('before-quit', handleDesktopBeforeQuit);
}

function configureDesktopShutdown(runtime: DesktopRuntime): void {
  desktopShutdownCoordinator = new DesktopShutdownCoordinator({
    closeRuntime: async (): Promise<void> => {
      await runtime.close();
      if (desktopRuntime === runtime) desktopRuntime = null;
    },
    onDeferred: (error): void => {
      quitRequested = false;
      console.error(`Desktop shutdown deferred: ${error.message}`);
      broadcastToAllWindows(pushChannels.logEvent, {
        id: Date.now(),
        timestamp: new Date().toISOString(),
        level: 'error',
        source: 'process',
        text: `Desktop shutdown deferred: ${error.message}`,
      });
      void dialog.showMessageBox({
        type: 'error',
        title: 'lnwjud is still running',
        message: 'The owned tunnel could not be confirmed stopped. lnwjud will remain open; retry Quit after checking the tunnel status.',
        detail: error.message,
        buttons: ['OK'],
      });
    },
  });
}

function handleDesktopBeforeQuit(event: Electron.Event): void {
  const coordinator = desktopShutdownCoordinator;
  if (coordinator === null || coordinator.canQuit()) {
    quitRequested = true;
    updateInstallCoordinator?.cancel();
    destroyDesktopTray();
    return;
  }
  event.preventDefault();
  quitRequested = true;
  void coordinator.requestQuit(() => app.quit()).then((result) => {
    if (result === 'deferred') quitRequested = false;
  });
}

function configureDataPath(): string {
  app.setName(APP_NAME);
  const dataPath = resolveLnwjudDataPath(process.env, app.getPath('appData'));
  app.setPath('userData', dataPath);
  const restore = applyPendingSqliteRestoreSync(path.join(dataPath, 'lnwjud.sqlite'), path.join(dataPath, 'backups'));
  if (restore.error !== undefined) console.error(`Scheduled database restore failed: ${restore.error}`);
  if (restore.applied) console.log(`Database restore applied from ${restore.backupId ?? 'scheduled backup'}`);
  return dataPath;
}

const gotInstanceLock = shouldHoldSingleInstanceLock(process.argv) ? app.requestSingleInstanceLock() : true;
if (!gotInstanceLock) {
  app.quit();
} else {
  if (shouldHoldSingleInstanceLock(process.argv)) {
    app.on('second-instance', (_event, argv) => {
      const existing = logViewerWindow !== null && !logViewerWindow.isDestroyed() ? logViewerWindow : null;
      if (existing !== null) {
        if (existing.isMinimized()) existing.restore();
        existing.show();
        existing.focus();
      } else if (argv.includes('--log-viewer')) {
        openLogViewerWindow();
      } else if (mainWindow !== null) {
        mainWindow.show();
        mainWindow.focus();
      }
    });
  }
  if (wantsMcpStdio(process.argv)) {
    bootstrapMcpStdio();
  } else if (process.argv.includes('--log-viewer')) {
    bootstrapLogViewerOnly();
  } else {
    bootstrapDesktop();
  }
}
