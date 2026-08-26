import type { TunnelStatus } from '@lnwjud/ipc-contracts';

export type GuidedTunnelSetupState = 'not_started' | 'in_progress' | 'dismissed' | 'completed';
export type GuidedTunnelLaunchDecision = 'none' | 'show_tip' | 'resume_settings';
export type GuidedTunnelStep = 'create_tunnel' | 'save_key' | 'configure' | 'start' | 'connect_chatgpt';

export const GUIDED_TUNNEL_SETUP_STORAGE_KEY = 'lnwjud.guided-tunnel-setup.v1';

const guidedTunnelSetupStates = new Set<GuidedTunnelSetupState>([
  'not_started',
  'in_progress',
  'dismissed',
  'completed',
]);

export function isFreshTunnelSetup(tunnel: TunnelStatus): boolean {
  return (
    !tunnel.hasApiKey &&
    !tunnel.profileExists &&
    (tunnel.persistent?.tunnelIdMasked ?? null) === null
  );
}

export function isTunnelConfigured(tunnel: TunnelStatus): boolean {
  return tunnel.hasApiKey && tunnel.profileExists;
}

export function isTunnelRunning(tunnel: TunnelStatus): boolean {
  return tunnel.state === 'running';
}

export function guidedTunnelLaunchDecision(
  tunnel: TunnelStatus,
  state: GuidedTunnelSetupState,
): GuidedTunnelLaunchDecision {
  if (state === 'dismissed' || state === 'completed' || isTunnelRunning(tunnel)) return 'none';
  if (state === 'in_progress') return 'resume_settings';
  return isFreshTunnelSetup(tunnel) ? 'show_tip' : 'none';
}

export function initialGuidedTunnelStep(tunnel: TunnelStatus): GuidedTunnelStep {
  if (tunnel.profileExists && tunnel.state === 'running') return 'connect_chatgpt';
  if (tunnel.profileExists && !tunnel.hasApiKey) return 'save_key';
  if (tunnel.profileExists) return 'start';
  return 'create_tunnel';
}

export function readGuidedTunnelSetupState(storage: Pick<Storage, 'getItem'>): GuidedTunnelSetupState {
  try {
    const value = storage.getItem(GUIDED_TUNNEL_SETUP_STORAGE_KEY);
    return guidedTunnelSetupStates.has(value as GuidedTunnelSetupState)
      ? (value as GuidedTunnelSetupState)
      : 'not_started';
  } catch {
    return 'not_started';
  }
}

export function writeGuidedTunnelSetupState(
  storage: Pick<Storage, 'setItem'>,
  state: GuidedTunnelSetupState,
): void {
  storage.setItem(GUIDED_TUNNEL_SETUP_STORAGE_KEY, state);
}
