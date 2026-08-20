import { existsSync } from 'node:fs';
import {
  allFixedDriveRoots,
  isDriveRoot,
  machineRootPath,
  normalizeWorkspaceRoot,
  type Workspace,
  type WorkspaceService,
} from '@lnwjud/workspace';

/** Ensure the drive containing the preferred workspace is registered as a machine root. */
export async function syncPreferredMachineRoot(
  workspaceService: WorkspaceService,
  preferredPath?: string,
): Promise<Workspace | null> {
  const root = machineRootPath(preferredPath);
  if (!existsSync(root)) return null;

  const existing = await workspaceService.list();
  const target = normalizeWorkspaceRoot(root).toLowerCase();
  const found = existing.find((entry) => normalizeWorkspaceRoot(entry.realRootPath).toLowerCase() === target);
  if (found !== undefined) return found;

  const added = await workspaceService.add(`Local Disk ${root[0]?.toUpperCase() ?? ''}:`, root);
  return added.ok ? added.value : null;
}

/** Register every existing fixed drive root without pruning previously registered roots. */
export async function syncAllDriveRoots(workspaceService: WorkspaceService): Promise<Workspace | null> {
  const roots = allFixedDriveRoots();
  if (roots.length === 0) return null;

  const existing = await workspaceService.list();
  let primary: Workspace | null = null;
  for (const root of roots) {
    const target = normalizeWorkspaceRoot(root).toLowerCase();
    const found = existing.find((entry) => normalizeWorkspaceRoot(entry.realRootPath).toLowerCase() === target);
    if (found !== undefined) {
      if (primary === null) primary = found;
      continue;
    }
    const added = await workspaceService.add(`Local Disk ${root[0]}:`, root);
    if (added.ok && primary === null) primary = added.value;
  }
  if (primary !== null) return primary;
  const after = await workspaceService.list();
  return after.find((entry) => isDriveRoot(entry.realRootPath)) ?? after[0] ?? null;
}

/** Machine-root synchronization for the current access mode. */
export function syncMachineRoots(
  workspaceService: WorkspaceService,
  unrestricted: boolean,
  preferredPath?: string,
): Promise<Workspace | null> {
  return unrestricted ? syncAllDriveRoots(workspaceService) : syncPreferredMachineRoot(workspaceService, preferredPath);
}
