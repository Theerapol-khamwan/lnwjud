import type { ReactElement } from 'react';
import type { PermissionProfileName } from '@lnwjud/ipc-contracts';

interface PermissionPanelProps {
  readonly profile: PermissionProfileName;
  readonly onChange: (profile: PermissionProfileName) => Promise<void>;
}

export function PermissionPanel({ profile, onChange }: PermissionPanelProps): ReactElement {
  return (
    <section className="card permission-card">
      <div className="section-heading"><h2>Permission profile</h2><span data-testid="permission-profile">{profileLabel(profile)}</span></div>
      <label htmlFor="permission-profile-select">Profile controls execution and write prompts.</label>
      <select
        id="permission-profile-select"
        aria-label="Permission profile"
        value={profile}
        onChange={(event) => {
          const next = event.currentTarget.value;
          if (isPermissionProfileName(next)) void onChange(next);
        }}
      >
        <option value="safe">Safe</option>
        <option value="balanced">Balanced</option>
        <option value="full">Full Access</option>
        <option value="custom">Custom</option>
      </select>
    </section>
  );
}

function isPermissionProfileName(value: string): value is PermissionProfileName {
  return value === 'safe' || value === 'balanced' || value === 'full' || value === 'custom';
}

function profileLabel(profile: PermissionProfileName): string {
  return profile === 'full' ? 'Full Access' : profile.charAt(0).toUpperCase() + profile.slice(1);
}
