import { useEffect, useState, type ReactElement } from 'react';
import type { DashboardSnapshot, PermissionProfileName, UiLocale, UserSettings } from '@lnwjud/ipc-contracts';
import { createTranslator } from '../../i18n/index.js';
import { UserConfigPanel } from './UserConfigPanel.js';

interface SettingsPageProps {
  readonly locale: UiLocale;
  readonly dashboard: DashboardSnapshot;
  readonly onLocaleChange: (locale: UiLocale) => Promise<void>;
  readonly onPermissionProfileChange: (profile: PermissionProfileName) => Promise<void>;
  readonly onUnrestrictedChange: (enabled: boolean) => Promise<boolean>;
  readonly onAiDeleteChange: (enabled: boolean) => Promise<void>;
  readonly onStdioPolicyChange: (profile: PermissionProfileName, strictRoots: boolean, allowedRoots: readonly string[]) => Promise<boolean>;
  readonly onCreateBackup: () => Promise<void>;
  readonly onScheduleRestoreBackup: (backupId: string) => Promise<boolean>;
  readonly onSaveTunnelApiKey: (apiKey: string) => Promise<void>;
  readonly onSetTunnelClientPath: (clientPath: string) => Promise<void>;
  readonly onUserSettingsChange: (settings: UserSettings) => Promise<boolean>;
  readonly onChooseTunnelClientPath: () => Promise<string | null>;
  readonly onConfigureTunnelProfile: (tunnelId: string) => Promise<string>;
}

export function SettingsPage(props: SettingsPageProps): ReactElement {
  const t = createTranslator(props.locale);
  const [apiKey, setApiKey] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);
  const [clientPath, setClientPath] = useState(props.dashboard.tunnel.clientPath ?? '');
  const [tunnelId, setTunnelId] = useState('');
  const [tunnelBusy, setTunnelBusy] = useState(false);
  const [tunnelMessage, setTunnelMessage] = useState<string | null>(null);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const [unrestrictedMessage, setUnrestrictedMessage] = useState<string | null>(null);
  const [stdioProfile, setStdioProfile] = useState<PermissionProfileName>(props.dashboard.stdioPermissionProfile);
  const [strictRoots, setStrictRoots] = useState(props.dashboard.stdioStrictRoots);
  const [allowedRootsText, setAllowedRootsText] = useState(props.dashboard.stdioAllowedRoots.join('\n'));
  const [stdioDirty, setStdioDirty] = useState(false);
  const [stdioMessage, setStdioMessage] = useState<string | null>(null);
  const [policyError, setPolicyError] = useState<string | null>(null);
  const [backupMessage, setBackupMessage] = useState<string | null>(null);
  const [backupError, setBackupError] = useState<string | null>(null);
  const [backupBusy, setBackupBusy] = useState(false);

  const persistedRootsText = props.dashboard.stdioAllowedRoots.join('\n');
  useEffect(() => {
    if (stdioDirty) return;
    setStdioProfile(props.dashboard.stdioPermissionProfile);
    setStrictRoots(props.dashboard.stdioStrictRoots);
    setAllowedRootsText(persistedRootsText);
  }, [props.dashboard.stdioPermissionProfile, props.dashboard.stdioStrictRoots, persistedRootsText, stdioDirty]);

  useEffect(() => {
    setClientPath(props.dashboard.tunnel.clientPath ?? '');
  }, [props.dashboard.tunnel.clientPath]);

  async function saveStdioPolicy(): Promise<void> {
    const roots = splitList(allowedRootsText);
    if (strictRoots && roots.length === 0) {
      setPolicyError(props.locale === 'th' ? 'Strict Roots ต้องกำหนด Allowed Root อย่างน้อย 1 path' : 'Strict Roots requires at least one Allowed Root path.');
      return;
    }
    setPolicyError(null);
    try {
      const restartRequired = await props.onStdioPolicyChange(stdioProfile, strictRoots, roots);
      setStdioDirty(false);
      setStdioMessage(restartRequired
        ? (props.locale === 'th' ? 'บันทึกแล้ว — Restart Tunnel เพื่อใช้ policy ใหม่กับ connection ปัจจุบัน' : 'Saved — restart Tunnel to apply the new policy to the current connection.')
        : t('settings.saved'));
    } catch (cause: unknown) {
      setPolicyError(cause instanceof Error ? cause.message : 'Could not save STDIO policy');
    }
  }

  async function browseTunnelClient(): Promise<void> {
    try {
      const selected = await props.onChooseTunnelClientPath();
      if (selected === null) return;
      setClientPath(selected);
      await props.onSetTunnelClientPath(selected);
      setSavedMessage(props.locale === 'th' ? 'บันทึก tunnel-client.exe แล้ว' : 'tunnel-client.exe saved.');
    } catch (cause: unknown) {
      setTunnelMessage(cause instanceof Error ? cause.message : 'Could not select tunnel-client.exe');
    }
  }

  async function configureTunnel(): Promise<void> {
    if (tunnelId.trim().length === 0) {
      setTunnelMessage(props.locale === 'th' ? 'กรุณาใส่ Tunnel ID' : 'Enter a Tunnel ID.');
      return;
    }
    setTunnelBusy(true);
    setTunnelMessage(null);
    try {
      const profilePath = await props.onConfigureTunnelProfile(tunnelId.trim());
      setTunnelMessage(props.locale === 'th' ? `ตั้งค่า Tunnel สำเร็จ: ${profilePath}` : `Tunnel configured: ${profilePath}`);
    } catch (cause: unknown) {
      setTunnelMessage(cause instanceof Error ? cause.message : (props.locale === 'th' ? 'ตั้งค่า Tunnel ไม่สำเร็จ' : 'Tunnel setup failed.'));
    } finally {
      setTunnelBusy(false);
    }
  }

  async function createBackupNow(): Promise<void> {
    setBackupBusy(true);
    setBackupError(null);
    try {
      await props.onCreateBackup();
      setBackupMessage(props.locale === 'th' ? 'สำรองข้อมูลเรียบร้อยแล้ว' : 'Backup completed.');
    } catch (cause: unknown) {
      setBackupError(cause instanceof Error ? cause.message : 'Backup failed');
    } finally {
      setBackupBusy(false);
    }
  }

  async function scheduleRestore(backupId: string): Promise<void> {
    setBackupBusy(true);
    setBackupError(null);
    try {
      const restartRequired = await props.onScheduleRestoreBackup(backupId);
      setBackupMessage(restartRequired
        ? (props.locale === 'th' ? 'เตรียม Restore แล้ว — ปิดและเปิด lnwjud ใหม่เพื่อใช้ข้อมูลชุดนี้' : 'Restore scheduled — restart lnwjud to apply it.')
        : (props.locale === 'th' ? 'เตรียม Restore แล้ว' : 'Restore scheduled.'));
    } catch (cause: unknown) {
      setBackupError(cause instanceof Error ? cause.message : 'Could not schedule restore');
    } finally {
      setBackupBusy(false);
    }
  }

  return (
    <div className="page-content">
      <div className="page-heading"><div><h1>{t('settings.title')}</h1><p className="page-subtitle">{t('settings.subtitle')}</p></div></div>

      <div className="settings-grid">
        <section className="panel settings-card" aria-label={t('settings.generalTitle')}>
          <div className="section-heading"><h2 className="settings-card-title"><span className="settings-icon">🌐</span>{t('settings.generalTitle')}</h2><span className="pill-badge gold">{props.locale.toUpperCase()}</span></div>
          <label className="field-label" htmlFor="locale-select">{t('settings.locale')}</label>
          <select id="locale-select" className="settings-select" value={props.locale} onChange={(event) => { void props.onLocaleChange(event.target.value as UiLocale); }}><option value="th">🇹🇭 {t('language.th')}</option><option value="en">🇺🇸 {t('language.en')}</option></select>
          <p className="hint">{props.locale === 'th' ? 'เปลี่ยนภาษาหน้าจอ Tray และข้อความระบบทันที' : 'Changes screen, tray, and system-message language immediately.'}</p>
        </section>

        <section className="panel settings-card" aria-label={t('settings.securityTitle')}>
          <div className="section-heading"><h2 className="settings-card-title"><span className="settings-icon">🛡️</span>{t('settings.securityTitle')}</h2><span className="pill-badge gold" data-testid="permission-profile">{props.dashboard.permissionProfile.toUpperCase()}</span></div>
          <label className="field-label" htmlFor="permission-profile">{t('settings.permissions')}</label>
          <select id="permission-profile" aria-label="Permission profile" className="settings-select" value={props.dashboard.permissionProfile} onChange={(event) => { void props.onPermissionProfileChange(event.target.value as PermissionProfileName); }}>
            <option value="safe">🛡️ {t('permission.safe')}</option><option value="balanced">⚖️ {t('permission.balanced')}</option><option value="full">⚡ {t('permission.full')}</option><option value="custom">🔧 {t('permission.custom')}</option>
          </select>
          <p className="hint">{profileHint(props.locale, props.dashboard.permissionProfile)}</p>
        </section>
      </div>

      <UserConfigPanel locale={props.locale} settings={props.dashboard.settings} onSave={props.onUserSettingsChange} />

      <section className="panel settings-card unrestricted-hero-card" aria-label={t('settings.unrestricted')}>
        <div className="section-heading">
          <div className="unrestricted-title-wrap"><span className="settings-icon">⚡</span><div><h2 className="settings-card-title">{t('settings.unrestricted')}</h2><span className="page-subtitle">Unrestricted Power Execution Profile</span></div></div>
          <Toggle checked={props.dashboard.unrestricted} label={props.dashboard.unrestricted ? 'ON' : 'OFF'} onChange={(enabled) => { void props.onUnrestrictedChange(enabled).then((restartRequired) => setUnrestrictedMessage(restartRequired ? t('settings.restartRequired') : null)); }} />
        </div>
        <p className="hint unrestricted-explanation">{t('settings.unrestrictedHint')}</p>
        {unrestrictedMessage === null ? null : <div className="alert-box-warning" role="status">⚠️ {unrestrictedMessage}</div>}
      </section>

      <section className="panel settings-card" aria-label="AI delete policy">
        <div className="section-heading"><div className="unrestricted-title-wrap"><span className="settings-icon">🗑️</span><div><h2 className="settings-card-title">{props.locale === 'th' ? 'สิทธิ์ AI ลบไฟล์' : 'AI File Delete Policy'}</h2><span className="page-subtitle">Scoped delete_file policy</span></div></div><Toggle checked={props.dashboard.allowAiDelete} label={props.dashboard.allowAiDelete ? 'ON' : 'OFF'} onChange={(enabled) => { void props.onAiDeleteChange(enabled); }} /></div>
        <p className="hint">{props.locale === 'th' ? 'อนุญาต delete_file ภายใน workspace ที่กำหนด โดยยังไม่ปลดล็อกคำสั่ง shell ลบไฟล์แบบกว้าง' : 'Allows scoped delete_file inside authorized workspaces without broadly unlocking destructive shell deletion.'}</p>
      </section>

      <section className="panel settings-card" aria-label="STDIO security policy">
        <div className="section-heading"><h2 className="settings-card-title"><span className="settings-icon">🔒</span>STDIO / Tunnel Security Policy</h2><span className="pill-badge gold">{props.dashboard.stdioPermissionProfile.toUpperCase()}</span></div>
        <div className="tunnel-config-grid">
          <div><label className="field-label" htmlFor="stdio-profile">STDIO Permission Profile</label><select id="stdio-profile" className="settings-select" value={stdioProfile} onChange={(event) => { setStdioProfile(event.target.value as PermissionProfileName); setStdioDirty(true); }}><option value="safe">Safe</option><option value="balanced">Balanced</option><option value="full">Full</option><option value="custom">Custom</option></select></div>
          <div><label className="field-label">Strict Workspace Roots</label><Toggle checked={strictRoots} label={strictRoots ? 'ON' : 'OFF'} onChange={(enabled) => { setStrictRoots(enabled); setStdioDirty(true); }} /></div>
        </div>
        <label className="field-label" htmlFor="stdio-roots">{props.locale === 'th' ? 'Allowed Roots — หนึ่ง path ต่อบรรทัด' : 'Allowed Roots — one path per line'}</label>
        <textarea id="stdio-roots" className="settings-textarea" rows={5} value={allowedRootsText} placeholder={'E:\\Projects\\MyApp\nD:\\Shared\\Source'} onChange={(event) => { setAllowedRootsText(event.target.value); setStdioDirty(true); }} />
        <p className="hint">{strictRoots ? (props.locale === 'th' ? 'Strict ON: absolute path นอก Allowed Roots จะถูกปฏิเสธแบบ fail-closed' : 'Strict ON: absolute paths outside Allowed Roots are rejected fail-closed.') : (props.locale === 'th' ? 'Strict OFF: คง machine-root behavior เดิมเพื่อ compatibility' : 'Strict OFF: preserves existing machine-root behavior for compatibility.')}</p>
        <div className="inline-actions"><button type="button" className="btn-save-gold" disabled={!stdioDirty} onClick={() => { void saveStdioPolicy(); }}>{props.locale === 'th' ? 'บันทึก STDIO Policy' : 'Save STDIO Policy'}</button></div>
        {policyError === null ? null : <div className="alert-box-warning" role="alert">⚠️ {policyError}</div>}{stdioMessage === null ? null : <div className="toast-success-banner" role="status">✨ {stdioMessage}</div>}
      </section>

      <section className="panel settings-card" aria-label={t('settings.tunnelTitle')}>
        <div className="section-heading"><h2 className="settings-card-title"><span className="settings-icon">☁️</span>{t('settings.tunnelTitle')}</h2><span className={`pill-badge ${props.dashboard.tunnel.profileExists ? 'gold' : ''}`}>{props.dashboard.tunnel.profileExists ? (props.locale === 'th' ? 'Profile พร้อม' : 'Profile Ready') : (props.locale === 'th' ? 'ต้องตั้งค่า' : 'Setup Required')}</span></div>
        <div className="tunnel-config-grid">
          <div><label className="field-label" htmlFor="tunnel-key">{t('settings.tunnelKey')}</label><div className="form-row"><div className="password-input-wrapper"><input id="tunnel-key" type={showApiKey ? 'text' : 'password'} placeholder={props.dashboard.tunnel.hasApiKey ? '••••••••••••••••' : 'sk-...'} value={apiKey} onChange={(event) => setApiKey(event.target.value)} autoComplete="off" /><button type="button" className="toggle-pw-btn" onClick={() => setShowApiKey((value) => !value)}>{showApiKey ? '🙈' : '👁️'}</button></div><button type="button" className="btn-save-gold" onClick={() => { void props.onSaveTunnelApiKey(apiKey).then(() => { setApiKey(''); setSavedMessage(t('settings.saved')); }); }}>{t('settings.saveKey')}</button></div><p className="hint">{props.dashboard.tunnel.hasApiKey ? '•••••••• (Windows DPAPI)' : t('tunnel.needKey')}</p></div>
          <div><label className="field-label" htmlFor="tunnel-client-path">{t('settings.clientPath')}</label><div className="form-row"><input id="tunnel-client-path" placeholder="C:\\tools\\tunnel-client.exe" value={clientPath} onChange={(event) => setClientPath(event.target.value)} /><button type="button" onClick={() => { void browseTunnelClient(); }}>{props.locale === 'th' ? 'เลือกไฟล์…' : 'Browse…'}</button><button type="button" className="btn-save-gold" onClick={() => { void props.onSetTunnelClientPath(clientPath).then(() => setSavedMessage(t('settings.saved'))); }}>{t('settings.savePath')}</button></div></div>
        </div>
        <div className="tunnel-setup-box"><label className="field-label" htmlFor="tunnel-id">OpenAI Tunnel ID</label><div className="form-row"><input id="tunnel-id" placeholder="tunnel_0123456789abcdef..." value={tunnelId} onChange={(event) => setTunnelId(event.target.value)} /><button type="button" className="btn-save-gold" disabled={tunnelBusy} onClick={() => { void configureTunnel(); }}>{tunnelBusy ? (props.locale === 'th' ? 'กำลังตั้งค่า…' : 'Configuring…') : (props.locale === 'th' ? 'Configure Tunnel อัตโนมัติ' : 'Configure Tunnel')}</button></div><p className="hint">{props.locale === 'th' ? 'สร้างและตรวจ lnwjud.yaml ด้วย tunnel-client โดยไม่ต้องเปิด PowerShell init เอง' : 'Creates and validates lnwjud.yaml with tunnel-client without manual PowerShell init.'}</p></div>
        {savedMessage === null ? null : <div className="toast-success-banner" role="status">✨ {savedMessage}</div>}{tunnelMessage === null ? null : <div className="alert-box-warning" role="status">{tunnelMessage}</div>}
      </section>

      <section className="panel settings-card" aria-label="Backup and restore">
        <div className="section-heading"><div className="unrestricted-title-wrap"><span className="settings-icon">💾</span><div><h2 className="settings-card-title">{props.locale === 'th' ? 'สำรองและกู้คืนข้อมูล' : 'Backup & Restore'}</h2><span className="page-subtitle">SQLite consistent snapshots</span></div></div><button type="button" className="btn-save-gold" disabled={backupBusy} onClick={() => { void createBackupNow(); }}>{backupBusy ? (props.locale === 'th' ? 'กำลังทำงาน…' : 'Working…') : (props.locale === 'th' ? 'Backup ตอนนี้' : 'Backup Now')}</button></div>
        {props.dashboard.backups.length === 0 ? <p className="hint">{props.locale === 'th' ? 'ยังไม่มี Backup' : 'No backups yet'}</p> : <div className="backup-list">{props.dashboard.backups.slice(0, 5).map((backup) => <div key={backup.id} className="backup-item"><div><strong>{new Date(backup.createdAt).toLocaleString(props.locale === 'th' ? 'th-TH' : 'en-US')}</strong><p className="hint">{backup.reason} · {formatBytes(backup.sizeBytes)}</p></div><button type="button" disabled={backupBusy || props.dashboard.tunnel.state === 'running' || props.dashboard.mcp.running} onClick={() => { void scheduleRestore(backup.id); }}>{props.locale === 'th' ? 'Restore ชุดนี้' : 'Restore'}</button></div>)}</div>}
        {(props.dashboard.tunnel.state === 'running' || props.dashboard.mcp.running) ? <div className="alert-box-warning">⚠️ {props.locale === 'th' ? 'หยุด Tunnel และ Local MCP ก่อน Restore' : 'Stop Tunnel and local MCP before scheduling a restore.'}</div> : null}{backupError === null ? null : <div className="alert-box-warning" role="alert">⚠️ {backupError}</div>}{backupMessage === null ? null : <div className="toast-success-banner" role="status">✨ {backupMessage}</div>}
      </section>
    </div>
  );
}

function Toggle({ checked, label, onChange }: { readonly checked: boolean; readonly label: string; readonly onChange: (enabled: boolean) => void }): ReactElement {
  return <div className="toggle-switch-container"><label className="modern-toggle-label"><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /><span className="modern-toggle-slider"></span></label><span className={`status-pill-toggle ${checked ? 'active' : ''}`}>{label}</span></div>;
}

function splitList(value: string): readonly string[] {
  const seen = new Set<string>();
  return value.split(/[;\r\n]+/).map((entry) => entry.trim()).filter((entry) => { if (entry.length === 0) return false; const key = entry.toLowerCase(); if (seen.has(key)) return false; seen.add(key); return true; });
}

function profileHint(locale: UiLocale, profile: PermissionProfileName): string {
  const th = { safe: 'ปลอดภัยสูงสุด: งานเขียนและรันคำสั่งต้องขออนุญาต', balanced: 'สมดุล: งานทั่วไปใน workspace ทำได้คล่องขึ้น', full: 'เต็มสิทธิ์ตาม policy ที่ยังคงบล็อก operation อันตรายระดับระบบ', custom: 'ใช้กฎ READ / WRITE / EXECUTE / DANGEROUS และ executable ที่กำหนดเองด้านบน' } as const;
  const en = { safe: 'Maximum safety: writes and execution require approval.', balanced: 'Balanced: common workspace work is less restrictive.', full: 'Full access within policy; machine-destructive operations remain blocked.', custom: 'Uses your READ / WRITE / EXECUTE / DANGEROUS rules and custom executables above.' } as const;
  return (locale === 'th' ? th : en)[profile];
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value < 0) return '0 B';
  if (value < 1024) return value + ' B';
  if (value < 1024 * 1024) return (value / 1024).toFixed(1) + ' KB';
  return (value / (1024 * 1024)).toFixed(1) + ' MB';
}
