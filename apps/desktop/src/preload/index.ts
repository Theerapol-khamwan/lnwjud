import { contextBridge, ipcRenderer } from 'electron';
import {
  ipcChannels,
  type AddWorkspaceRequest,
  type DashboardSnapshot,
  type DoctorCheck,
  type DoctorReport,
  type LnwjudApi,
  type PermissionProfileName,
  type ProcessSummary,
  type SetPermissionProfileRequest,
  type StopProcessRequest,
  type WorkspaceSummary,
} from '@lnwjud/ipc-contracts';

function invoke(channel: string, payload?: unknown): Promise<unknown> {
  return payload === undefined ? ipcRenderer.invoke(channel) : ipcRenderer.invoke(channel, payload);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringField(value: Record<string, unknown>, field: string): string {
  const fieldValue = value[field];
  if (typeof fieldValue !== 'string') throw new Error('Invalid IPC response');
  return fieldValue;
}

function booleanField(value: Record<string, unknown>, field: string): boolean {
  const fieldValue = value[field];
  if (typeof fieldValue !== 'boolean') throw new Error('Invalid IPC response');
  return fieldValue;
}

function numberField(value: Record<string, unknown>, field: string): number {
  const fieldValue = value[field];
  if (typeof fieldValue !== 'number' || !Number.isFinite(fieldValue)) throw new Error('Invalid IPC response');
  return fieldValue;
}

function workspaceSummary(value: unknown): WorkspaceSummary {
  if (!isRecord(value)) throw new Error('Invalid IPC response');
  return {
    id: stringField(value, 'id'),
    displayName: stringField(value, 'displayName'),
    rootPath: stringField(value, 'rootPath'),
    realRootPath: stringField(value, 'realRootPath'),
    createdAt: stringField(value, 'createdAt'),
  };
}

function workspaceList(value: unknown): readonly WorkspaceSummary[] {
  if (!Array.isArray(value)) throw new Error('Invalid IPC response');
  return value.map(workspaceSummary);
}

function permissionProfile(value: unknown): PermissionProfileName {
  if (value === 'safe' || value === 'balanced' || value === 'full' || value === 'custom') return value;
  throw new Error('Invalid IPC response');
}

function dashboard(value: unknown): DashboardSnapshot {
  if (!isRecord(value) || !isRecord(value.gitSummary) || !isRecord(value.mcp) || !isRecord(value.codex)) {
    throw new Error('Invalid IPC response');
  }
  const selectedWorkspace = value.selectedWorkspace === null ? null : workspaceSummary(value.selectedWorkspace);
  const url = value.mcp.url;
  const version = value.codex.version;
  if ((url !== null && typeof url !== 'string') || (version !== null && typeof version !== 'string')) {
    throw new Error('Invalid IPC response');
  }
  return {
    selectedWorkspace,
    gitSummary: {
      branch: value.gitSummary.branch === null ? null : stringField(value.gitSummary, 'branch'),
      changedFiles: numberField(value.gitSummary, 'changedFiles'),
      stagedFiles: numberField(value.gitSummary, 'stagedFiles'),
    },
    mcp: { running: booleanField(value.mcp, 'running'), url },
    codex: { installed: booleanField(value.codex, 'installed'), version },
    managedProcessCount: numberField(value, 'managedProcessCount'),
    auditEventCount: numberField(value, 'auditEventCount'),
    permissionProfile: permissionProfile(value.permissionProfile),
  };
}

function processSummary(value: unknown): ProcessSummary {
  if (!isRecord(value) || !Array.isArray(value.args)) throw new Error('Invalid IPC response');
  const state = processState(value.state);
  if (value.args.some((arg) => typeof arg !== 'string')) throw new Error('Invalid IPC response');
  return {
    id: stringField(value, 'id'),
    workspaceId: stringField(value, 'workspaceId'),
    executable: stringField(value, 'executable'),
    args: value.args,
    state,
  };
}

function processState(value: unknown): ProcessSummary['state'] {
  if (value === 'starting' || value === 'running' || value === 'exited' || value === 'failed' || value === 'stopping') {
    return value;
  }
  throw new Error('Invalid IPC response');
}

function processList(value: unknown): readonly ProcessSummary[] {
  if (!Array.isArray(value)) throw new Error('Invalid IPC response');
  return value.map(processSummary);
}

function doctorReport(value: unknown): DoctorReport {
  if (!isRecord(value) || !Array.isArray(value.checks) || (value.exitCode !== 0 && value.exitCode !== 1)) {
    throw new Error('Invalid IPC response');
  }
  const checks: readonly DoctorCheck[] = value.checks.map((check) => {
    if (!isRecord(check) || typeof check.required !== 'boolean') throw new Error('Invalid IPC response');
    const status = check.status;
    if (status !== 'pass' && status !== 'warn' && status !== 'fail') throw new Error('Invalid IPC response');
    return {
      id: stringField(check, 'id'),
      required: check.required,
      status,
      message: stringField(check, 'message'),
    };
  });
  return { checks, exitCode: value.exitCode };
}

function addWorkspace(request: AddWorkspaceRequest): Promise<WorkspaceSummary> {
  if (!isRecord(request) || typeof request.rootPath !== 'string' || request.rootPath.trim().length === 0) {
    return Promise.reject(new Error('Invalid IPC request'));
  }
  return invoke(ipcChannels.addWorkspace, { rootPath: request.rootPath }).then(workspaceSummary);
}

function setPermissionProfile(request: SetPermissionProfileRequest): Promise<{ readonly profile: PermissionProfileName }> {
  if (!isRecord(request)) return Promise.reject(new Error('Invalid IPC request'));
  const profile = permissionProfile(request.profile);
  return invoke(ipcChannels.setPermissionProfile, { profile }).then((value: unknown) => {
    if (!isRecord(value)) throw new Error('Invalid IPC response');
    return { profile: permissionProfile(value.profile) };
  });
}

function stopProcess(request: StopProcessRequest): Promise<{ readonly stopped: boolean }> {
  if (!isRecord(request) || typeof request.processId !== 'string' || request.processId.trim().length === 0) {
    return Promise.reject(new Error('Invalid IPC request'));
  }
  return invoke(ipcChannels.stopProcess, { processId: request.processId }).then((value: unknown) => {
    if (!isRecord(value)) throw new Error('Invalid IPC response');
    return { stopped: booleanField(value, 'stopped') };
  });
}

const api: LnwjudApi = {
  listWorkspaces: () => invoke(ipcChannels.listWorkspaces).then(workspaceList),
  addWorkspace,
  getDashboard: () => invoke(ipcChannels.getDashboard).then(dashboard),
  setPermissionProfile,
  listProcesses: () => invoke(ipcChannels.listProcesses).then(processList),
  stopProcess,
  runDoctor: () => invoke(ipcChannels.runDoctor).then(doctorReport),
};

contextBridge.exposeInMainWorld('lnwjud', api);
