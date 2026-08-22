export const APP_NAME = 'lnwjud';
export const APP_VERSION = '4.8.0';

export const ipcChannels = {
  listWorkspaces: 'lnwjud:list-workspaces',
  addWorkspace: 'lnwjud:add-workspace',
  selectWorkspace: 'lnwjud:select-workspace',
  getDashboard: 'lnwjud:get-dashboard',
  setPermissionProfile: 'lnwjud:set-permission-profile',
  setUnrestrictedMode: 'lnwjud:set-unrestricted-mode',
  setAiDeletePolicy: 'lnwjud:set-ai-delete-policy',
  setStdioPolicy: 'lnwjud:set-stdio-policy',
  createBackup: 'lnwjud:create-backup',
  scheduleRestoreBackup: 'lnwjud:schedule-restore-backup',
  listProcesses: 'lnwjud:list-processes',
  startProcess: 'lnwjud:start-process',
  stopProcess: 'lnwjud:stop-process',
  startMcp: 'lnwjud:start-mcp',
  stopMcp: 'lnwjud:stop-mcp',
  restartMcp: 'lnwjud:restart-mcp',
  clearWorkLog: 'lnwjud:clear-work-log',
  saveTunnelApiKey: 'lnwjud:save-tunnel-api-key',
  startTunnel: 'lnwjud:start-tunnel',
  stopTunnel: 'lnwjud:stop-tunnel',
  getTunnelStatus: 'lnwjud:get-tunnel-status',
  setTunnelClientPath: 'lnwjud:set-tunnel-client-path',
  setLocale: 'lnwjud:set-locale',
  setUserSettings: 'lnwjud:set-user-settings',
  chooseTunnelClientPath: 'lnwjud:choose-tunnel-client-path',
  configureTunnelProfile: 'lnwjud:configure-tunnel-profile',
  launchManagedBrowser: 'lnwjud:launch-managed-browser',
  runDoctor: 'lnwjud:run-doctor',
  getLogSnapshot: 'lnwjud:get-log-snapshot',
  clearLogBuffer: 'lnwjud:clear-log-buffer',
  exportLogs: 'lnwjud:export-logs',
  captureIncident: 'lnwjud:capture-incident',
  openLogViewer: 'lnwjud:open-log-viewer',
  getUpdateStatus: 'lnwjud:get-update-status',
  checkForUpdates: 'lnwjud:check-for-updates',
  installUpdate: 'lnwjud:install-update',
} as const;

export const pushChannels = {
  logEvent: 'lnwjud:event:log',
  updateStatus: 'lnwjud:event:update-status',
} as const;

export type IpcChannel = typeof ipcChannels[keyof typeof ipcChannels];
export type PermissionProfileName = 'safe' | 'balanced' | 'full' | 'custom';
export type UiLocale = 'th' | 'en';
export type AgentState = 'stopped' | 'idle' | 'busy';
export type TunnelRunState = 'stopped' | 'starting' | 'running' | 'error';
export type UpdatePhase = 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'installing' | 'up-to-date' | 'error' | 'unavailable';

export interface UpdateStatus {
  readonly phase: UpdatePhase;
  readonly currentVersion: string;
  readonly availableVersion: string | null;
  readonly progressPercent: number | null;
  readonly lastCheckedAt: string | null;
  readonly message: string | null;
  readonly canInstall: boolean;
}

export type CloseBehavior = 'tray' | 'quit';
export type PermissionDecisionSetting = 'ALLOW' | 'ASK' | 'DENY';
export type ExtensionMode = 'enable_all' | 'allowlist';

export interface CustomPermissionSettings {
  readonly read: PermissionDecisionSetting;
  readonly write: PermissionDecisionSetting;
  readonly execute: PermissionDecisionSetting;
  readonly dangerous: PermissionDecisionSetting;
  readonly allowedExecutables: readonly string[];
}

export interface ExtraMcpServerSettings {
  readonly name: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly type: string;
  readonly env: Readonly<Record<string, string>>;
}

export interface UserSettings {
  readonly customPermission: CustomPermissionSettings;
  readonly mcpCallTimeoutMs: number;
  readonly mcpIdleTimeoutMs: number;
  readonly processTimeoutMs: number;
  readonly capabilityRoots: readonly string[];
  readonly pdfProviderPath: string;
  readonly lspCommands: Readonly<Record<string, string>>;
  readonly mcpHttpPort: number;
  readonly codexToolsEnabled: boolean;
  readonly updateAutoCheck: boolean;
  readonly updateCheckOnStartup: boolean;
  readonly updateIntervalMinutes: number;
  readonly updateAutoDownload: boolean;
  readonly closeBehavior: CloseBehavior;
  readonly launchAtStartup: boolean;
  readonly startMinimized: boolean;
  readonly tunnelAutoReconnect: boolean;
  readonly tunnelMaxAutoRestarts: number;
  readonly extensions: {
    readonly mode: ExtensionMode;
    readonly disabledServers: readonly string[];
    readonly enabledServers: readonly string[];
    readonly disabledSkillRoots: readonly string[];
    readonly extraSkillRoots: readonly string[];
    readonly extraMcpServers: readonly ExtraMcpServerSettings[];
  };
}

export interface WorkspaceSummary {
  readonly id: string;
  readonly displayName: string;
  readonly rootPath: string;
  readonly realRootPath: string;
  readonly createdAt: string;
}

export type CapabilityToolName = 'shell' | 'dom_cdp' | 'accessibility' | 'input_event' | 'vision' | 'window' | 'health' | 'system_info' | 'notification' | 'file_dialog' | 'clipboard' | 'web_fetch' | 'audio' | 'screen_record' | 'office' | 'scheduler' | 'wsl_exec' | 'wsl_fs';

export interface CapabilitySummary {
  readonly name: CapabilityToolName;
  readonly title: string;
  readonly description: string;
  readonly available: boolean;
  readonly ready: boolean;
}

export interface WorkLogEntry {
  readonly id: string;
  readonly timestamp: string;
  readonly kind: 'task' | 'result' | 'error';
  readonly toolName: string;
  readonly resultCode: string;
  readonly errorMessage: string | null;
  readonly targetSummary: string | null;
  readonly durationMs: number;
  readonly workspaceId: string | null;
  readonly callId?: string;
}

export interface InFlightWorkItem {
  readonly callId: string;
  readonly toolName: string;
  readonly startedAt: string;
  readonly targetSummary: string | null;
  readonly workspaceId: string | null;
}

export interface ConnectionModes {
  readonly httpUrl: string | null;
  readonly stdioCommand: string;
}

export interface TunnelStatus {
  readonly state: TunnelRunState;
  /** desktop = started by this app; external = started by a script or another process. */
  readonly source: 'desktop' | 'external';
  readonly hasApiKey: boolean;
  readonly clientPath: string | null;
  readonly profileExists: boolean;
  readonly message: string | null;
  readonly logPath: string | null;
}

export type LogSource = 'tunnel' | 'mcp' | 'process';
export type LogLevel = 'info' | 'warn' | 'error';

export interface LogLine {
  readonly id: number;
  readonly source: LogSource;
  readonly timestamp: string;
  readonly level: LogLevel;
  readonly text: string;
  readonly correlation?: LogCorrelation;
}

export type McpResultCode = 'SUCCESS' | 'FAILED' | 'FATAL' | 'UNKNOWN';
export type TunnelLifecycleCategory = 'ttl_expired' | 'stdio_stopped' | 'transport_stopped' | 'transport_live' | 'other';
export type LogCorrelation =
  | { readonly kind: 'mcp'; readonly phase: 'started' | 'completed'; readonly callId: string; readonly toolName: string; readonly resultCode: McpResultCode | null }
  | { readonly kind: 'tunnel'; readonly lifecycle?: TunnelLifecycleCategory; readonly instanceId?: string; readonly requestId?: string; readonly pid?: number };

export interface LogSnapshot {
  readonly lines: readonly LogLine[];
  readonly tunnelLogPath: string | null;
  readonly tunnelLogExists: boolean;
}

export interface ClearLogBufferRequest {
  readonly source: LogSource;
}

export interface ExportLogsRequest {
  readonly source: LogSource;
  readonly filePath: string;
}

export type IncidentClassification = 'local_tool_failed' | 'tunnel_disconnected' | 'remote_turn_stopped' | 'healthy_or_inconclusive';
export interface IncidentExportResult {
  readonly exported: boolean;
  readonly cancelled: boolean;
  readonly classification: IncidentClassification;
  readonly capturedAt: string | null;
}

export interface GitStatusEntrySummary {
  readonly path: string;
  readonly kind: string;
  readonly indexStatus: string;
  readonly worktreeStatus: string;
}

export interface DashboardGitSummary {
  readonly branch: string | null;
  readonly changedFiles: number;
  readonly stagedFiles: number;
  readonly message: string;
  readonly repositoryPath?: string | null;
  readonly isRepo?: boolean;
  readonly entries?: readonly GitStatusEntrySummary[];
}

export interface BackupSummary {
  readonly id: string;
  readonly createdAt: string;
  readonly reason: 'daily' | 'manual' | 'pre-update' | 'pre-migration';
  readonly sizeBytes: number;
}

export interface DashboardSnapshot {
  readonly selectedWorkspace: WorkspaceSummary | null;
  readonly gitSummary: DashboardGitSummary;
  readonly mcp: {
    readonly running: boolean;
    readonly url: string | null;
    readonly workspaceId: string | null;
  };
  readonly codex: {
    readonly installed: boolean;
    readonly version: string | null;
  };
  readonly managedProcessCount: number;
  readonly auditEventCount: number;
  readonly recentAuditEvents: readonly AuditEventSummary[];
  readonly permissionProfile: PermissionProfileName;
  readonly capabilities: readonly CapabilitySummary[];
  readonly agentState: AgentState;
  readonly mode: 'WORK';
  readonly locale: UiLocale;
  readonly unrestricted: boolean;
  /** When true, the scoped delete_file tool may delete within its workspace without per-call chat confirmation. */
  readonly allowAiDelete: boolean;
  readonly stdioPermissionProfile: PermissionProfileName;
  readonly stdioStrictRoots: boolean;
  readonly stdioAllowedRoots: readonly string[];
  readonly backups: readonly BackupSummary[];
  readonly connectionModes: ConnectionModes;
  readonly workLog: readonly WorkLogEntry[];
  readonly inFlight: readonly InFlightWorkItem[];
  readonly tunnel: TunnelStatus;
  readonly settings: UserSettings;
  readonly appVersion: string;
}

export interface AuditEventSummary {
  readonly id: string;
  readonly timestamp: string;
  readonly action: string;
  readonly resultCode: string;
}

export interface ProcessSummary {
  readonly id: string;
  readonly workspaceId: string;
  readonly executable: string;
  readonly args: readonly string[];
  readonly state: 'starting' | 'running' | 'exited' | 'failed' | 'stopped' | 'timed_out' | 'termination_unverified';
  readonly logSummary: string;
}

export type DoctorCheckStatus = 'pass' | 'warn' | 'fail';

export interface DoctorCheck {
  readonly id: string;
  readonly required: boolean;
  readonly status: DoctorCheckStatus;
  readonly message: string;
}

export interface DoctorReport {
  readonly checks: readonly DoctorCheck[];
  readonly exitCode: 0 | 1;
}

export interface AddWorkspaceRequest {
  readonly rootPath: string;
}

export interface SelectWorkspaceRequest {
  readonly workspaceId: string;
}

export interface SetPermissionProfileRequest {
  readonly profile: PermissionProfileName;
}

export interface SetUnrestrictedModeRequest {
  readonly enabled: boolean;
}

export interface SetAiDeletePolicyRequest {
  readonly enabled: boolean;
}

export interface SetStdioPolicyRequest {
  readonly profile: PermissionProfileName;
  readonly strictRoots: boolean;
  readonly allowedRoots: readonly string[];
}

export interface ScheduleRestoreBackupRequest {
  readonly backupId: string;
}

export interface StartProcessRequest {
  readonly workspaceId: string;
  readonly mode: 'fixture' | 'project-dev';
}

export interface StopProcessRequest {
  readonly processId: string;
}

export interface StartMcpRequest {
  readonly workspaceId: string;
}

export interface SaveTunnelApiKeyRequest {
  readonly apiKey: string;
}

export interface SetTunnelClientPathRequest {
  readonly clientPath: string;
}

export interface SetLocaleRequest {
  readonly locale: UiLocale;
}

export interface SetUserSettingsRequest {
  readonly settings: UserSettings;
}

export interface ConfigureTunnelProfileRequest {
  readonly tunnelId: string;
}

export interface McpConnectionStatus {
  readonly running: boolean;
  readonly url: string | null;
  readonly workspaceId: string | null;
}

export interface ManagedBrowserStatus {
  readonly ready: boolean;
  readonly port: number;
  readonly launched: boolean;
}

export interface IpcRequestMap {
  readonly [ipcChannels.listWorkspaces]: undefined;
  readonly [ipcChannels.addWorkspace]: AddWorkspaceRequest;
  readonly [ipcChannels.selectWorkspace]: SelectWorkspaceRequest;
  readonly [ipcChannels.getDashboard]: undefined;
  readonly [ipcChannels.setPermissionProfile]: SetPermissionProfileRequest;
  readonly [ipcChannels.setUnrestrictedMode]: SetUnrestrictedModeRequest;
  readonly [ipcChannels.setAiDeletePolicy]: SetAiDeletePolicyRequest;
  readonly [ipcChannels.setStdioPolicy]: SetStdioPolicyRequest;
  readonly [ipcChannels.createBackup]: undefined;
  readonly [ipcChannels.scheduleRestoreBackup]: ScheduleRestoreBackupRequest;
  readonly [ipcChannels.listProcesses]: undefined;
  readonly [ipcChannels.startProcess]: StartProcessRequest;
  readonly [ipcChannels.stopProcess]: StopProcessRequest;
  readonly [ipcChannels.startMcp]: StartMcpRequest;
  readonly [ipcChannels.stopMcp]: undefined;
  readonly [ipcChannels.restartMcp]: undefined;
  readonly [ipcChannels.clearWorkLog]: undefined;
  readonly [ipcChannels.saveTunnelApiKey]: SaveTunnelApiKeyRequest;
  readonly [ipcChannels.startTunnel]: undefined;
  readonly [ipcChannels.stopTunnel]: undefined;
  readonly [ipcChannels.getTunnelStatus]: undefined;
  readonly [ipcChannels.setTunnelClientPath]: SetTunnelClientPathRequest;
  readonly [ipcChannels.setLocale]: SetLocaleRequest;
  readonly [ipcChannels.setUserSettings]: SetUserSettingsRequest;
  readonly [ipcChannels.chooseTunnelClientPath]: undefined;
  readonly [ipcChannels.configureTunnelProfile]: ConfigureTunnelProfileRequest;
  readonly [ipcChannels.launchManagedBrowser]: undefined;
  readonly [ipcChannels.runDoctor]: undefined;
  readonly [ipcChannels.getLogSnapshot]: undefined;
  readonly [ipcChannels.clearLogBuffer]: ClearLogBufferRequest;
  readonly [ipcChannels.exportLogs]: ExportLogsRequest;
  readonly [ipcChannels.captureIncident]: undefined;
  readonly [ipcChannels.openLogViewer]: undefined;
  readonly [ipcChannels.getUpdateStatus]: undefined;
  readonly [ipcChannels.checkForUpdates]: undefined;
  readonly [ipcChannels.installUpdate]: undefined;
}

export interface IpcResponseMap {
  readonly [ipcChannels.listWorkspaces]: readonly WorkspaceSummary[];
  readonly [ipcChannels.addWorkspace]: WorkspaceSummary;
  readonly [ipcChannels.selectWorkspace]: WorkspaceSummary;
  readonly [ipcChannels.getDashboard]: DashboardSnapshot;
  readonly [ipcChannels.setPermissionProfile]: { readonly profile: PermissionProfileName };
  readonly [ipcChannels.setUnrestrictedMode]: { readonly unrestricted: boolean; readonly restartRequired: boolean };
  readonly [ipcChannels.setAiDeletePolicy]: { readonly enabled: boolean };
  readonly [ipcChannels.setStdioPolicy]: { readonly profile: PermissionProfileName; readonly strictRoots: boolean; readonly allowedRoots: readonly string[]; readonly restartRequired: boolean };
  readonly [ipcChannels.createBackup]: BackupSummary;
  readonly [ipcChannels.scheduleRestoreBackup]: { readonly scheduled: boolean; readonly restartRequired: boolean };
  readonly [ipcChannels.listProcesses]: readonly ProcessSummary[];
  readonly [ipcChannels.startProcess]: ProcessSummary;
  readonly [ipcChannels.stopProcess]: { readonly stopped: boolean };
  readonly [ipcChannels.startMcp]: McpConnectionStatus;
  readonly [ipcChannels.stopMcp]: McpConnectionStatus;
  readonly [ipcChannels.restartMcp]: McpConnectionStatus;
  readonly [ipcChannels.clearWorkLog]: { readonly cleared: boolean };
  readonly [ipcChannels.saveTunnelApiKey]: { readonly saved: boolean };
  readonly [ipcChannels.startTunnel]: TunnelStatus;
  readonly [ipcChannels.stopTunnel]: TunnelStatus;
  readonly [ipcChannels.getTunnelStatus]: TunnelStatus;
  readonly [ipcChannels.setTunnelClientPath]: { readonly clientPath: string };
  readonly [ipcChannels.setLocale]: { readonly locale: UiLocale };
  readonly [ipcChannels.setUserSettings]: { readonly settings: UserSettings; readonly restartRequired: boolean };
  readonly [ipcChannels.chooseTunnelClientPath]: { readonly clientPath: string | null };
  readonly [ipcChannels.configureTunnelProfile]: { readonly configured: boolean; readonly profilePath: string };
  readonly [ipcChannels.launchManagedBrowser]: ManagedBrowserStatus;
  readonly [ipcChannels.runDoctor]: DoctorReport;
  readonly [ipcChannels.getLogSnapshot]: LogSnapshot;
  readonly [ipcChannels.clearLogBuffer]: { readonly cleared: boolean };
  readonly [ipcChannels.exportLogs]: { readonly exported: boolean };
  readonly [ipcChannels.captureIncident]: IncidentExportResult;
  readonly [ipcChannels.openLogViewer]: { readonly opened: boolean };
  readonly [ipcChannels.getUpdateStatus]: UpdateStatus;
  readonly [ipcChannels.checkForUpdates]: UpdateStatus;
  readonly [ipcChannels.installUpdate]: { readonly accepted: boolean; readonly status: UpdateStatus };
}

export interface LnwjudApi {
  listWorkspaces(): Promise<IpcResponseMap[typeof ipcChannels.listWorkspaces]>;
  addWorkspace(request: AddWorkspaceRequest): Promise<IpcResponseMap[typeof ipcChannels.addWorkspace]>;
  selectWorkspace(request: SelectWorkspaceRequest): Promise<IpcResponseMap[typeof ipcChannels.selectWorkspace]>;
  getDashboard(): Promise<IpcResponseMap[typeof ipcChannels.getDashboard]>;
  setPermissionProfile(request: SetPermissionProfileRequest): Promise<IpcResponseMap[typeof ipcChannels.setPermissionProfile]>;
  setUnrestrictedMode(request: SetUnrestrictedModeRequest): Promise<IpcResponseMap[typeof ipcChannels.setUnrestrictedMode]>;
  setAiDeletePolicy(request: SetAiDeletePolicyRequest): Promise<IpcResponseMap[typeof ipcChannels.setAiDeletePolicy]>;
  setStdioPolicy(request: SetStdioPolicyRequest): Promise<IpcResponseMap[typeof ipcChannels.setStdioPolicy]>;
  createBackup(): Promise<IpcResponseMap[typeof ipcChannels.createBackup]>;
  scheduleRestoreBackup(request: ScheduleRestoreBackupRequest): Promise<IpcResponseMap[typeof ipcChannels.scheduleRestoreBackup]>;
  listProcesses(): Promise<IpcResponseMap[typeof ipcChannels.listProcesses]>;
  startProcess(request: StartProcessRequest): Promise<IpcResponseMap[typeof ipcChannels.startProcess]>;
  stopProcess(request: StopProcessRequest): Promise<IpcResponseMap[typeof ipcChannels.stopProcess]>;
  startMcp(request: StartMcpRequest): Promise<IpcResponseMap[typeof ipcChannels.startMcp]>;
  stopMcp(): Promise<IpcResponseMap[typeof ipcChannels.stopMcp]>;
  restartMcp(): Promise<IpcResponseMap[typeof ipcChannels.restartMcp]>;
  clearWorkLog(): Promise<IpcResponseMap[typeof ipcChannels.clearWorkLog]>;
  saveTunnelApiKey(request: SaveTunnelApiKeyRequest): Promise<IpcResponseMap[typeof ipcChannels.saveTunnelApiKey]>;
  startTunnel(): Promise<IpcResponseMap[typeof ipcChannels.startTunnel]>;
  stopTunnel(): Promise<IpcResponseMap[typeof ipcChannels.stopTunnel]>;
  getTunnelStatus(): Promise<IpcResponseMap[typeof ipcChannels.getTunnelStatus]>;
  setTunnelClientPath(request: SetTunnelClientPathRequest): Promise<IpcResponseMap[typeof ipcChannels.setTunnelClientPath]>;
  setLocale(request: SetLocaleRequest): Promise<IpcResponseMap[typeof ipcChannels.setLocale]>;
  setUserSettings(request: SetUserSettingsRequest): Promise<IpcResponseMap[typeof ipcChannels.setUserSettings]>;
  chooseTunnelClientPath(): Promise<IpcResponseMap[typeof ipcChannels.chooseTunnelClientPath]>;
  configureTunnelProfile(request: ConfigureTunnelProfileRequest): Promise<IpcResponseMap[typeof ipcChannels.configureTunnelProfile]>;
  launchManagedBrowser(): Promise<IpcResponseMap[typeof ipcChannels.launchManagedBrowser]>;
  runDoctor(): Promise<IpcResponseMap[typeof ipcChannels.runDoctor]>;
  getLogSnapshot(): Promise<IpcResponseMap[typeof ipcChannels.getLogSnapshot]>;
  clearLogBuffer(request: ClearLogBufferRequest): Promise<IpcResponseMap[typeof ipcChannels.clearLogBuffer]>;
  exportLogs(request: ExportLogsRequest): Promise<IpcResponseMap[typeof ipcChannels.exportLogs]>;
  captureIncident(): Promise<IpcResponseMap[typeof ipcChannels.captureIncident]>;
  openLogViewer(): Promise<IpcResponseMap[typeof ipcChannels.openLogViewer]>;
  getUpdateStatus(): Promise<IpcResponseMap[typeof ipcChannels.getUpdateStatus]>;
  checkForUpdates(): Promise<IpcResponseMap[typeof ipcChannels.checkForUpdates]>;
  installUpdate(): Promise<IpcResponseMap[typeof ipcChannels.installUpdate]>;
  onLogEvent(callback: (line: LogLine) => void): () => void;
  onUpdateStatus(callback: (status: UpdateStatus) => void): () => void;
}
