import { useState, type ReactElement } from 'react';
import type { DashboardSnapshot, PermissionProfileName, UiLocale } from '@lnwjud/ipc-contracts';
import { createTranslator } from '../../i18n/index.js';

interface SettingsPageProps {
  readonly locale: UiLocale;
  readonly dashboard: DashboardSnapshot;
  readonly onLocaleChange: (locale: UiLocale) => Promise<void>;
  readonly onPermissionProfileChange: (profile: PermissionProfileName) => Promise<void>;
  readonly onUnrestrictedChange: (enabled: boolean) => Promise<boolean>;
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

  const profileSummary = {
    safe: props.locale === 'th' ? 'ระดับปลอดภัยสูงสุด: ยืนยันทุกคำสั่งที่มีผลกระทบ' : 'Maximum safety: Prompts for all file mutations',
    balanced: props.locale === 'th' ? 'ระดับสมดุล (แนะนำ): อนุญาตอ่านและเขียนไฟล์ทั่วไปใน workspace' : 'Balanced (Recommended): Allows safe workspace read/writes',
    full: props.locale === 'th' ? 'ระดับเต็มสิทธิ์: รันคำสั่งและแก้ไขไฟล์อัตโนมัติ' : 'Full access: Runs commands and edits files automatically',
    custom: props.locale === 'th' ? 'โปรไฟล์กำหนดเอง: อิงตามค่าคอนฟิกใน lnwjud.yaml' : 'Custom profile: Defined in lnwjud.yaml config',
  }[props.dashboard.permissionProfile];

  return (
    <div className="page-content">
      <div className="page-heading">
        <div>
          <h1>{t('settings.title')}</h1>
          <p className="page-subtitle">{t('settings.subtitle')}</p>
        </div>
      </div>

      <div className="settings-grid">
        {/* Card 1: Language Preferences */}
        <section className="panel settings-card" aria-label={t('settings.generalTitle')}>
          <div className="section-heading">
            <h2 className="settings-card-title">
              <span className="settings-icon">🌐</span>
              {t('settings.generalTitle')}
            </h2>
            <span className="pill-badge gold">{props.locale.toUpperCase()}</span>
          </div>
          
          <label className="field-label" htmlFor="locale-select">{t('settings.locale')}</label>
          <div className="form-row">
            <select
              id="locale-select"
              className="settings-select"
              value={props.locale}
              onChange={(event) => { void props.onLocaleChange(event.target.value as UiLocale); }}
            >
              <option value="th">🇹🇭 {t('language.th')}</option>
              <option value="en">🇺🇸 {t('language.en')}</option>
            </select>
          </div>
          <p className="hint">
            {props.locale === 'th' ? 'สลับภาษาของหน้าจอและการแจ้งเตือนทั้งหมด' : 'Switch the display language for all screens and notifications'}
          </p>
        </section>

        {/* Card 2: Permission Profile */}
        <section className="panel settings-card" aria-label={t('settings.securityTitle')}>
          <div className="section-heading">
            <h2 className="settings-card-title">
              <span className="settings-icon">🛡️</span>
              {t('settings.securityTitle')}
            </h2>
            <span className="pill-badge gold" data-testid="permission-profile">
              {props.dashboard.permissionProfile.toUpperCase()}
            </span>
          </div>

          <label className="field-label" htmlFor="permission-profile">{t('settings.permissions')}</label>
          <div className="form-row">
            <select
              id="permission-profile"
              aria-label="Permission profile"
              className="settings-select"
              value={props.dashboard.permissionProfile}
              onChange={(event) => { void props.onPermissionProfileChange(event.target.value as PermissionProfileName); }}
            >
              <option value="safe">🛡️ {t('permission.safe')}</option>
              <option value="balanced">⚖️ {t('permission.balanced')}</option>
              <option value="full">⚡ {t('permission.full')}</option>
              <option value="custom">🔧 {t('permission.custom')}</option>
            </select>
          </div>
          <p className="hint">{profileSummary}</p>
        </section>
      </div>

      {/* Card 3: Unrestricted Mode Hero Card */}
      <section className="panel settings-card unrestricted-hero-card" aria-label={t('settings.unrestricted')}>
        <div className="section-heading">
          <div className="unrestricted-title-wrap">
            <span className="settings-icon">⚡</span>
            <div>
              <h2 className="settings-card-title">{t('settings.unrestricted')}</h2>
              <span className="page-subtitle">Unrestricted Power Execution Profile</span>
            </div>
          </div>
          <div className="toggle-switch-container">
            <label className="modern-toggle-label" htmlFor="unrestricted-mode">
              <input
                id="unrestricted-mode"
                type="checkbox"
                checked={props.dashboard.unrestricted}
                onChange={(event) => {
                  void props.onUnrestrictedChange(event.target.checked).then((restartRequired) => {
                    setUnrestrictedMessage(restartRequired ? t('settings.restartRequired') : null);
                  });
                }}
              />
              <span className="modern-toggle-slider"></span>
            </label>
            <span
              data-testid="unrestricted-state"
              className={`status-pill-toggle ${props.dashboard.unrestricted ? 'active' : ''}`}
            >
              {props.dashboard.unrestricted ? 'ON' : 'OFF'}
            </span>
          </div>
        </div>

        <p className="hint unrestricted-explanation">{t('settings.unrestrictedHint')}</p>
        {unrestrictedMessage === null ? null : (
          <div className="alert-box-warning" role="status">
            ⚠️ {unrestrictedMessage}
          </div>
        )}
      </section>

      {/* Card 4: OpenAI Secure MCP Tunnel */}
      <section className="panel settings-card" aria-label={t('settings.tunnelTitle')}>
        <div className="section-heading">
          <h2 className="settings-card-title">
            <span className="settings-icon">☁️</span>
            {t('settings.tunnelTitle')}
          </h2>
          <span className={`pill-badge ${props.dashboard.tunnel.hasApiKey ? 'gold' : ''}`}>
            {props.dashboard.tunnel.hasApiKey ? (props.locale === 'th' ? 'ตั้งค่าแล้ว' : 'Configured') : (props.locale === 'th' ? 'ยังไม่ได้ใส่คีย์' : 'No Key')}
          </span>
        </div>

        <div className="tunnel-config-grid">
          <div>
            <label className="field-label" htmlFor="tunnel-key">{t('settings.tunnelKey')}</label>
            <div className="form-row">
              <div className="password-input-wrapper">
                <input
                  id="tunnel-key"
                  type={showApiKey ? 'text' : 'password'}
                  placeholder={props.dashboard.tunnel.hasApiKey ? '••••••••••••••••••••••••' : 'sk-...'}
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                  autoComplete="off"
                />
                <button
                  type="button"
                  className="toggle-pw-btn"
                  onClick={() => setShowApiKey((prev) => !prev)}
                  title={showApiKey ? 'Hide key' : 'Show key'}
                >
                  {showApiKey ? '🙈' : '👁️'}
                </button>
              </div>
              <button
                type="button"
                className="btn-save-gold"
                onClick={() => {
                  void props.onSaveTunnelApiKey(apiKey).then(() => {
                    setApiKey('');
                    setSavedMessage(t('settings.saved'));
                    setTimeout(() => setSavedMessage(null), 3000);
                  });
                }}
              >
                {t('settings.saveKey')}
              </button>
            </div>
            <p className="hint">
              {props.dashboard.tunnel.hasApiKey ? '•••••••• (บันทึกอยู่ในระบบแล้ว)' : t('tunnel.needKey')}
            </p>
          </div>

          <div>
            <label className="field-label" htmlFor="tunnel-client-path">{t('settings.clientPath')}</label>
            <div className="form-row">
              <input
                id="tunnel-client-path"
                placeholder="C:\tools\tunnel-client.exe"
                value={clientPath}
                onChange={(event) => setClientPath(event.target.value)}
              />
              <button
                type="button"
                className="btn-save-gold"
                onClick={() => {
                  void props.onSetTunnelClientPath(clientPath).then(() => {
                    setSavedMessage(t('settings.saved'));
                    setTimeout(() => setSavedMessage(null), 3000);
                  });
                }}
              >
                {t('settings.savePath')}
              </button>
            </div>
            <p className="hint">
              {props.locale === 'th' ? 'path สำหรับรัน OpenAI tunnel-client.exe' : 'Path to the OpenAI tunnel-client.exe executable'}
            </p>
          </div>
        </div>

        {savedMessage === null ? null : (
          <div className="toast-success-banner" role="status">
            ✨ {savedMessage}
          </div>
        )}
      </section>
    </div>
  );
}
