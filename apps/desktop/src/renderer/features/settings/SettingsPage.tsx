import { useEffect, useState, type ReactElement } from 'react';
import type { DashboardSnapshot, PermissionProfileName, UiLocale } from '@lnwjud/ipc-contracts';
import { createTranslator } from '../../i18n/index.js';

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
}

export function SettingsPage(props: SettingsPageProps): ReactElement {
  const t = createTranslator(props.locale);
  const [apiKey, setApiKey] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);
  const [clientPath, setClientPath] = useState(props.dashboard.tunnel.clientPath ?? '');
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const [unrestrictedMessage, setUnrestrictedMessage] = useState<string | null>(null);
  const [stdioProfile, setStdioProfile] = useState<PermissionProfileName>(props.dashboard.stdioPermissionProfile);
  const [strictRoots, setStrictRoots] = useState(props.dashboard.stdioStrictRoots);
  const [allowedRootsText, setAllowedRootsText] = useState(props.dashboard.stdioAllowedRoots.join('\n'));
  const [stdioMessage, setStdioMessage] = useState<string | null>(null);
  const [policyError, setPolicyError] = useState<string | null>(null);
  const [backupMessage, setBackupMessage] = useState<string | null>(null);
  const [backupError, setBackupError] = useState<string | null>(null);
  const [backupBusy, setBackupBusy] = useState(false);

  const persistedRootsText = props.dashboard.stdioAllowedRoots.join('\n');
  useEffect(() => {
    setStdioProfile(props.dashboard.stdioPermissionProfile);
    setStrictRoots(props.dashboard.stdioStrictRoots);
    setAllowedRootsText(persistedRootsText);
  }, [props.dashboard.stdioPermissionProfile, props.dashboard.stdioStrictRoots, persistedRootsText]);

  const profileSummary = {
    safe: props.locale === 'th' ? 'ระดับปลอดภัยสูงสุด: ยืนยันทุกคำสั่งที่มีผลกระทบ' : 'Maximum safety: prompts for file mutations and execution',
    balanced: props.locale === 'th' ? 'ระดับสมดุล (แนะนำ): อนุญาตอ่านและเขียนไฟล์ทั่วไปใน workspace' : 'Balanced (Recommended): allows safe workspace read/writes',
    full: props.locale === 'th' ? 'ระดับเต็มสิทธิ์: รันคำสั่งและแก้ไขไฟล์อัตโนมัติ' : 'Full access: runs commands and edits files automatically',
    custom: props.locale === 'th' ? 'โปรไฟล์กำหนดเองตามค่าคอนฟิกของ lnwjud' : 'Custom profile based on lnwjud configuration',
  }[props.dashboard.permissionProfile];

  const allowedRoots = (): readonly string[] => allowedRootsText
    .split(/[;\r\n]+/)
    .map((root) => root.trim())
    .filter((root, index, all) => root.length > 0 && all.findIndex((entry) => entry.toLowerCase() === root.toLowerCase()) === index);

  async function createBackupNow(): Promise<void> {
    setBackupBusy(true);
    setBackupError(null);
    try {
      await props.onCreateBackup();
      setBackupMessage(props.locale === 'th' ? 'สำรองข้อมูลเรียบร้อยแล้ว' : 'Backup completed');
    } catch (cause: unknown) {
      setBackupError(cause instanceof Error ? cause.message : (props.locale === 'th' ? 'สำรองข้อมูลไม่สำเร็จ' : 'Backup failed'));
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
        ? (props.locale === 'th' ? 'เตรียม Restore แล้ว — ปิดและเปิด lnwjud ใหม่เพื่อใช้งานข้อมูลชุดนี้' : 'Restore scheduled — restart lnwjud to apply this backup')
        : (props.locale === 'th' ? 'เตรียม Restore แล้ว' : 'Restore scheduled'));
    } catch (cause: unknown) {
      setBackupError(cause instanceof Error ? cause.message : (props.locale === 'th' ? 'เตรียม Restore ไม่สำเร็จ' : 'Could not schedule restore'));
    } finally {
      setBackupBusy(false);
    }
  }

  async function saveStdioPolicy(): Promise<void> {
    const roots = allowedRoots();
    if (strictRoots && roots.length === 0) {
      setPolicyError(props.locale === 'th' ? 'Strict Roots ต้องกำหนด Allowed Root อย่างน้อย 1 path' : 'Strict Roots requires at least one Allowed Root path');
      return;
    }
    setPolicyError(null);
    try {
      const restartRequired = await props.onStdioPolicyChange(stdioProfile, strictRoots, roots);
      setStdioMessage(restartRequired
        ? (props.locale === 'th' ? 'บันทึกแล้ว — ให้ Restart Tunnel เพื่อให้ connection ปัจจุบันใช้ policy ใหม่' : 'Saved — restart Tunnel so the current connection uses the new policy')
        : t('settings.saved'));
    } catch (cause: unknown) {
      setPolicyError(cause instanceof Error ? cause.message : (props.locale === 'th' ? 'บันทึก STDIO policy ไม่สำเร็จ' : 'Could not save STDIO policy'));
    }
  }

  return (
    <div className="page-content">
      <div className="page-heading">
        <div>
          <h1>{t('settings.title')}</h1>
          <p className="page-subtitle">{t('settings.subtitle')}</p>
        </div>
      </div>

      <div className="settings-grid">
        <section className="panel settings-card" aria-label={t('settings.generalTitle')}>
          <div className="section-heading">
            <h2 className="settings-card-title"><span className="settings-icon">🌐</span>{t('settings.generalTitle')}</h2>
            <span className="pill-badge gold">{props.locale.toUpperCase()}</span>
          </div>
          <label className="field-label" htmlFor="locale-select">{t('settings.locale')}</label>
          <div className="form-row">
            <select id="locale-select" className="settings-select" value={props.locale} onChange={(event) => { void props.onLocaleChange(event.target.value as UiLocale); }}>
              <option value="th">🇹🇭 {t('language.th')}</option>
              <option value="en">🇺🇸 {t('language.en')}</option>
            </select>
          </div>
          <p className="hint">{props.locale === 'th' ? 'สลับภาษาของหน้าจอและการแจ้งเตือนทั้งหมด' : 'Switch the display language for all screens and notifications'}</p>
        </section>

        <section className="panel settings-card" aria-label={t('settings.securityTitle')}>
          <div className="section-heading">
            <h2 className="settings-card-title"><span className="settings-icon">🛡️</span>{t('settings.securityTitle')}</h2>
            <span className="pill-badge gold" data-testid="permission-profile">{props.dashboard.permissionProfile.toUpperCase()}</span>
          </div>
          <label className="field-label" htmlFor="permission-profile">{t('settings.permissions')}</label>
          <div className="form-row">
            <select id="permission-profile" aria-label="Permission profile" className="settings-select" value={props.dashboard.permissionProfile} onChange={(event) => { void props.onPermissionProfileChange(event.target.value as PermissionProfileName); }}>
              <option value="safe">🛡️ {t('permission.safe')}</option>
              <option value="balanced">⚖️ {t('permission.balanced')}</option>
              <option value="full">⚡ {t('permission.full')}</option>
              <option value="custom">🔧 {t('permission.custom')}</option>
            </select>
          </div>
          <p className="hint">{profileSummary}</p>
        </section>
      </div>

      <section className="panel settings-card unrestricted-hero-card" aria-label={t('settings.unrestricted')}>
        <div className="section-heading">
          <div className="unrestricted-title-wrap">
            <span className="settings-icon">⚡</span>
            <div><h2 className="settings-card-title">{t('settings.unrestricted')}</h2><span className="page-subtitle">Unrestricted Power Execution Profile</span></div>
          </div>
          <div className="toggle-switch-container">
            <label className="modern-toggle-label" htmlFor="unrestricted-mode">
              <input id="unrestricted-mode" type="checkbox" checked={props.dashboard.unrestricted} onChange={(event) => { void props.onUnrestrictedChange(event.target.checked).then((restartRequired) => { setUnrestrictedMessage(restartRequired ? t('settings.restartRequired') : null); }); }} />
              <span className="modern-toggle-slider"></span>
            </label>
            <span data-testid="unrestricted-state" className={`status-pill-toggle ${props.dashboard.unrestricted ? 'active' : ''}`}>{props.dashboard.unrestricted ? 'ON' : 'OFF'}</span>
          </div>
        </div>
        <p className="hint unrestricted-explanation">{t('settings.unrestrictedHint')}</p>
        {unrestrictedMessage === null ? null : <div className="alert-box-warning" role="status">⚠️ {unrestrictedMessage}</div>}
      </section>

      <section className="panel settings-card" aria-label="AI delete policy">
        <div className="section-heading">
          <div className="unrestricted-title-wrap">
            <span className="settings-icon">🗑️</span>
            <div>
              <h2 className="settings-card-title">{props.locale === 'th' ? 'สิทธิ์ AI ลบไฟล์' : 'AI File Delete Policy'}</h2>
              <span className="page-subtitle">Scoped delete_file policy</span>
            </div>
          </div>
          <div className="toggle-switch-container">
            <label className="modern-toggle-label" htmlFor="allow-ai-delete">
              <input id="allow-ai-delete" type="checkbox" checked={props.dashboard.allowAiDelete} onChange={(event) => { void props.onAiDeleteChange(event.target.checked); }} />
              <span className="modern-toggle-slider"></span>
            </label>
            <span className={`status-pill-toggle ${props.dashboard.allowAiDelete ? 'active' : ''}`} data-testid="allow-ai-delete-state">{props.dashboard.allowAiDelete ? 'ON' : 'OFF'}</span>
          </div>
        </div>
        <p className="hint">
          {props.locale === 'th'
            ? 'เมื่อเปิด AI ใช้ delete_file ลบไฟล์หรือโฟลเดอร์ว่างภายใน workspace ที่อนุญาตได้โดยไม่ต้องถามยืนยันทุกครั้ง แต่ยังห้ามลบ workspace root และไม่ปลดล็อก rm/del/Remove-Item แบบ shell เพื่อไม่ให้ข้าม Strict Roots'
            : 'When enabled, AI may use delete_file inside an allowed workspace without per-call confirmation. Workspace-root deletion remains blocked, and arbitrary shell rm/del/Remove-Item stays confirmation-gated so Strict Roots cannot be bypassed.'}
        </p>
      </section>

      <section className="panel settings-card" aria-label="STDIO security policy">
        <div className="section-heading">
          <h2 className="settings-card-title"><span className="settings-icon">🔒</span>{props.locale === 'th' ? 'STDIO / Tunnel Security Policy' : 'STDIO / Tunnel Security Policy'}</h2>
          <span className="pill-badge gold">{props.dashboard.stdioPermissionProfile.toUpperCase()}</span>
        </div>
        <p className="hint">
          {props.locale === 'th'
            ? 'กำหนดสิทธิ์ของ MCP STDIO ที่ OpenAI Secure Tunnel เปิดขึ้นมา ค่าเริ่มต้นเป็น Full และใช้ machine roots เดิม; เปิด Strict Roots เมื่อต้องการจำกัดการเข้าถึงไว้เฉพาะ Allowed Roots'
            : 'Controls permissions for MCP STDIO launched by the OpenAI Secure Tunnel. The default remains Full with existing machine roots; enable Strict Roots to limit access to Allowed Roots only.'}
        </p>
        <div className="tunnel-config-grid">
          <div>
            <label className="field-label" htmlFor="stdio-profile">{props.locale === 'th' ? 'STDIO Permission Profile' : 'STDIO Permission Profile'}</label>
            <select id="stdio-profile" className="settings-select" value={stdioProfile} onChange={(event) => setStdioProfile(event.target.value as PermissionProfileName)}>
              <option value="safe">Safe</option><option value="balanced">Balanced</option><option value="full">Full</option><option value="custom">Custom</option>
            </select>
          </div>
          <div>
            <label className="field-label" htmlFor="strict-roots">Strict Workspace Roots</label>
            <div className="toggle-switch-container compact-toggle">
              <label className="modern-toggle-label" htmlFor="strict-roots">
                <input id="strict-roots" type="checkbox" checked={strictRoots} onChange={(event) => setStrictRoots(event.target.checked)} />
                <span className="modern-toggle-slider"></span>
              </label>
              <span className={`status-pill-toggle ${strictRoots ? 'active' : ''}`}>{strictRoots ? 'ON' : 'OFF'}</span>
            </div>
          </div>
        </div>
        <label className="field-label" htmlFor="stdio-allowed-roots">{props.locale === 'th' ? 'Allowed Roots — หนึ่ง path ต่อบรรทัด' : 'Allowed Roots — one path per line'}</label>
        <textarea
          id="stdio-allowed-roots"
          className="settings-textarea"
          rows={5}
          value={allowedRootsText}
          placeholder={'E:\\Projects\\MyApp\nD:\\Shared\\Source'}
          onChange={(event) => setAllowedRootsText(event.target.value)}
        />
        <p className="hint">
          {strictRoots
            ? (props.locale === 'th' ? 'Strict ON: STDIO จะไม่ลงทะเบียนทั้งไดรฟ์ และ absolute path นอก Allowed Roots จะถูกปฏิเสธแบบ fail-closed' : 'Strict ON: STDIO skips whole-drive registration and rejects absolute paths outside Allowed Roots (fail closed).')
            : (props.locale === 'th' ? 'Strict OFF: คงพฤติกรรมเดิมเพื่อ backward compatibility' : 'Strict OFF: preserves the existing behavior for backward compatibility.')}
        </p>
        <div className="inline-actions"><button type="button" className="btn-save-gold" onClick={() => { void saveStdioPolicy(); }}>{props.locale === 'th' ? 'บันทึก STDIO Policy' : 'Save STDIO Policy'}</button></div>
        {policyError === null ? null : <div className="alert-box-warning" role="alert">⚠️ {policyError}</div>}
        {stdioMessage === null ? null : <div className="toast-success-banner" role="status">✨ {stdioMessage}</div>}
      </section>

      <section className="panel settings-card" aria-label="Backup and restore">
        <div className="section-heading">
          <div className="unrestricted-title-wrap">
            <span className="settings-icon">💾</span>
            <div>
              <h2 className="settings-card-title">{props.locale === 'th' ? 'สำรองและกู้คืนข้อมูล' : 'Backup & Restore'}</h2>
              <span className="page-subtitle">SQLite consistent snapshots</span>
            </div>
          </div>
          <button type="button" className="btn-save-gold" disabled={backupBusy} onClick={() => { void createBackupNow(); }}>
            {backupBusy ? (props.locale === 'th' ? 'กำลังทำงาน…' : 'Working…') : (props.locale === 'th' ? 'Backup ตอนนี้' : 'Backup Now')}
          </button>
        </div>
        <p className="hint">
          {props.locale === 'th'
            ? 'lnwjud สำรองฐานข้อมูลอัตโนมัติประมาณวันละครั้ง และก่อนอัปเดต/ก่อน migration โดยใช้ SQLite snapshot ที่สอดคล้องกับ WAL ข้อมูล checkpoint ภายในฐานข้อมูลถูกเข้ารหัสแยกต่างหาก'
            : 'lnwjud creates a consistent SQLite snapshot about once per day and before updates/migrations. Checkpoint payloads inside the database are encrypted separately.'}
        </p>
        {props.dashboard.backups.length === 0 ? (
          <p className="hint">{props.locale === 'th' ? 'ยังไม่มี Backup' : 'No backups yet'}</p>
        ) : (
          <div className="backup-list">
            {props.dashboard.backups.slice(0, 5).map((backup) => (
              <div key={backup.id} className="backup-item">
                <div>
                  <strong>{new Date(backup.createdAt).toLocaleString(props.locale === 'th' ? 'th-TH' : 'en-US')}</strong>
                  <p className="hint">{backup.reason} · {formatBytes(backup.sizeBytes)}</p>
                </div>
                <button
                  type="button"
                  disabled={backupBusy || props.dashboard.tunnel.state === 'running' || props.dashboard.mcp.running}
                  onClick={() => { void scheduleRestore(backup.id); }}
                >
                  {props.locale === 'th' ? 'Restore ชุดนี้' : 'Restore'}
                </button>
              </div>
            ))}
          </div>
        )}
        {(props.dashboard.tunnel.state === 'running' || props.dashboard.mcp.running) ? (
          <div className="alert-box-warning">⚠️ {props.locale === 'th' ? 'หยุด Tunnel และ Local MCP ก่อนเลือก Restore เพื่อไม่ให้ฐานข้อมูลถูกใช้งานระหว่างกู้คืน' : 'Stop Tunnel and local MCP before scheduling a restore.'}</div>
        ) : null}
        {backupError === null ? null : <div className="alert-box-warning" role="alert">⚠️ {backupError}</div>}
        {backupMessage === null ? null : <div className="toast-success-banner" role="status">✨ {backupMessage}</div>}
      </section>

      <section className="panel settings-card" aria-label={t('settings.tunnelTitle')}>
        <div className="section-heading">
          <h2 className="settings-card-title"><span className="settings-icon">☁️</span>{t('settings.tunnelTitle')}</h2>
          <span className={`pill-badge ${props.dashboard.tunnel.hasApiKey ? 'gold' : ''}`}>{props.dashboard.tunnel.hasApiKey ? (props.locale === 'th' ? 'ตั้งค่าแล้ว' : 'Configured') : (props.locale === 'th' ? 'ยังไม่ได้ใส่คีย์' : 'No Key')}</span>
        </div>
        <div className="tunnel-config-grid">
          <div>
            <label className="field-label" htmlFor="tunnel-key">{t('settings.tunnelKey')}</label>
            <div className="form-row">
              <div className="password-input-wrapper">
                <input id="tunnel-key" type={showApiKey ? 'text' : 'password'} placeholder={props.dashboard.tunnel.hasApiKey ? '••••••••••••••••••••••••' : 'sk-...'} value={apiKey} onChange={(event) => setApiKey(event.target.value)} autoComplete="off" />
                <button type="button" className="toggle-pw-btn" onClick={() => setShowApiKey((prev) => !prev)} title={showApiKey ? 'Hide key' : 'Show key'}>{showApiKey ? '🙈' : '👁️'}</button>
              </div>
              <button type="button" className="btn-save-gold" onClick={() => { void props.onSaveTunnelApiKey(apiKey).then(() => { setApiKey(''); setSavedMessage(t('settings.saved')); setTimeout(() => setSavedMessage(null), 3000); }); }}>{t('settings.saveKey')}</button>
            </div>
            <p className="hint">{props.dashboard.tunnel.hasApiKey ? '•••••••• (บันทึกอยู่ในระบบแล้ว)' : t('tunnel.needKey')}</p>
          </div>
          <div>
            <label className="field-label" htmlFor="tunnel-client-path">{t('settings.clientPath')}</label>
            <div className="form-row">
              <input id="tunnel-client-path" placeholder="C:\\tools\\tunnel-client.exe" value={clientPath} onChange={(event) => setClientPath(event.target.value)} />
              <button type="button" className="btn-save-gold" onClick={() => { void props.onSetTunnelClientPath(clientPath).then(() => { setSavedMessage(t('settings.saved')); setTimeout(() => setSavedMessage(null), 3000); }); }}>{t('settings.savePath')}</button>
            </div>
            <p className="hint">{props.locale === 'th' ? 'path สำหรับรัน OpenAI tunnel-client.exe' : 'Path to the OpenAI tunnel-client.exe executable'}</p>
          </div>
        </div>
        {savedMessage === null ? null : <div className="toast-success-banner" role="status">✨ {savedMessage}</div>}
      </section>
    </div>
  );
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value < 0) return '0 B';
  if (value < 1024) return value + ' B';
  if (value < 1024 * 1024) return (value / 1024).toFixed(1) + ' KB';
  return (value / (1024 * 1024)).toFixed(1) + ' MB';
}
