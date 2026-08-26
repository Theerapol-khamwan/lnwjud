import { describe, expect, it } from 'vitest';
import type { TunnelStatus } from '@lnwjud/ipc-contracts';
import {
  guidedTunnelLaunchDecision,
  initialGuidedTunnelStep,
  isFreshTunnelSetup,
  isTunnelConfigured,
  isTunnelRunning,
  readGuidedTunnelSetupState,
  writeGuidedTunnelSetupState,
} from '../src/renderer/features/onboarding/guided-tunnel-setup-state.js';

function pristineTunnel(overrides: Partial<TunnelStatus> = {}): TunnelStatus {
  return {
    state: 'stopped',
    source: 'desktop',
    hasApiKey: false,
    clientPath: null,
    profileExists: false,
    message: null,
    logPath: null,
    persistent: null,
    ...overrides,
  };
}

describe('guided tunnel setup state', () => {
  it('shows Tips only for a pristine tunnel setup', () => {
    expect(guidedTunnelLaunchDecision(pristineTunnel(), 'not_started')).toBe('show_tip');
    expect(guidedTunnelLaunchDecision(pristineTunnel({ hasApiKey: true }), 'not_started')).toBe('none');
    expect(guidedTunnelLaunchDecision(pristineTunnel({ profileExists: true }), 'not_started')).toBe('none');
    expect(
      guidedTunnelLaunchDecision(
        pristineTunnel({
          persistent: {
            enabled: true,
            tunnelIdMasked: 'tunnel_0123********cdef',
            runtimeAlias: 'lnwjud',
            mode: 'native-managed',
            state: 'stopped',
            healthy: null,
            ready: null,
            pollHealthy: null,
            reconnectCount: 0,
            lastConnectedAt: null,
            lastReconnectAt: null,
            nextReconnectAt: null,
            lastErrorCode: null,
            clientVersion: null,
            localMcpUrl: null,
            uiUrl: null,
            readyBeforeRetire: false,
            strictZeroDowntime: false,
            capabilityEvidence: null,
          },
        }),
        'not_started',
      ),
    ).toBe('none');
  });

  it('resumes an in-progress setup until the tunnel reaches running', () => {
    expect(guidedTunnelLaunchDecision(pristineTunnel(), 'in_progress')).toBe('resume_settings');
    expect(guidedTunnelLaunchDecision(pristineTunnel({ state: 'running' }), 'in_progress')).toBe('none');
  });

  it('never auto-opens after dismissal or completion', () => {
    expect(guidedTunnelLaunchDecision(pristineTunnel(), 'dismissed')).toBe('none');
    expect(guidedTunnelLaunchDecision(pristineTunnel(), 'completed')).toBe('none');
  });

  it('derives fresh, configured, and running states from real tunnel status', () => {
    expect(isFreshTunnelSetup(pristineTunnel())).toBe(true);
    expect(isTunnelConfigured(pristineTunnel({ hasApiKey: true, profileExists: true }))).toBe(true);
    expect(isTunnelConfigured(pristineTunnel({ hasApiKey: true }))).toBe(false);
    expect(isTunnelRunning(pristineTunnel({ state: 'running' }))).toBe(true);
  });

  it('resumes at the first step required by the actual tunnel state', () => {
    expect(initialGuidedTunnelStep(pristineTunnel())).toBe('create_tunnel');
    expect(initialGuidedTunnelStep(pristineTunnel({ hasApiKey: true }))).toBe('create_tunnel');
    expect(initialGuidedTunnelStep(pristineTunnel({ profileExists: true }))).toBe('save_key');
    expect(initialGuidedTunnelStep(pristineTunnel({ hasApiKey: true, profileExists: true }))).toBe('start');
    expect(initialGuidedTunnelStep(pristineTunnel({ hasApiKey: true, profileExists: true, state: 'running' }))).toBe(
      'connect_chatgpt',
    );
  });

  it('stores only the finite onboarding state and tolerates corrupt values', () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string): string | null => values.get(key) ?? null,
      setItem: (key: string, value: string): void => {
        values.set(key, value);
      },
    };

    writeGuidedTunnelSetupState(storage, 'in_progress');
    expect(readGuidedTunnelSetupState(storage)).toBe('in_progress');
    expect([...values.values()]).toEqual(['in_progress']);

    values.set('lnwjud.guided-tunnel-setup.v1', 'corrupt');
    expect(readGuidedTunnelSetupState(storage)).toBe('not_started');
  });
});
