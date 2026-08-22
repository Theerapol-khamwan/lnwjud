import { useEffect, useState, type ReactElement } from 'react';
import type {
  ExtraMcpServerSettings,
  PermissionDecisionSetting,
  UiLocale,
  UserSettings,
} from '@lnwjud/ipc-contracts';

interface UserConfigPanelProps {
  readonly locale: UiLocale;
  readonly settings?: UserSettings;
  readonly onSave: (settings: UserSettings) => Promise<boolean>;
}

const DEFAULT_USER_SETTINGS: UserSettings = {
  customPermission: { read: 'ALLOW', write: 'ASK', execute: 'ASK', dangerous: 'DENY', allowedExecutables: [] },
  mcpCallTimeoutMs: 60_000,
  mcpIdleTimeoutMs: 5 * 60_000,
  processTimeoutMs: 60 * 60_000,
  capabilityRoots: [],
  mcpHttpPort: 18_765,
  updateAutoCheck: true,
  updateCheckOnStartup: true,
  updateIntervalMinutes: 30,
  updateAutoDownload: true,
  closeBehavior: 'tray',
  launchAtStartup: false,
  startMinimized: false,
  tunnelAutoReconnect: true,
  tunnelMaxAutoRestarts: 5,
  extensions: { mode: 'enable_all', disabledServers: [], enabledServers: [], disabledSkillRoots: [], extraSkillRoots: [], extraMcpServers: [] },
};

export function UserConfigPanel({ locale, settings, onSave }: UserConfigPanelProps): ReactElement {
  const effectiveSettings = settings ?? DEFAULT_USER_SETTINGS;
  const [draft, setDraft] = useState<UserSettings>(effectiveSettings);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!dirty) setDraft(effectiveSettings);
  }, [effectiveSettings, dirty]);

  function patch(next: Partial<UserSettings>): void {
    setDraft((previous) => ({ ...previous, ...next }));
    markDirty();
  }

  function patchCustom(next: Partial<UserSettings['customPermission']>): void {
    setDraft((previous) => ({ ...previous, customPermission: { ...previous.customPermission, ...next } }));
    markDirty();
  }

  function patchExtensions(next: Partial<UserSettings['extensions']>): void {
    setDraft((previous) => ({ ...previous, extensions: { ...previous.extensions, ...next } }));
    markDirty();
  }

  function markDirty(): void {
    setDirty(true);
    setMessage(null);
    setError(null);
  }

  function updateServer(index: number, next: Partial<ExtraMcpServerSettings>): void {
    patchExtensions({
      extraMcpServers: draft.extensions.extraMcpServers.map((server, current) => current === index ? { ...server, ...next } : server),
    });
  }

  function addServer(): void {
    const used = new Set(draft.extensions.extraMcpServers.map((server) => server.name.toLowerCase()));
    let sequence = draft.extensions.extraMcpServers.length + 1;
    while (used.has(`mcp-server-${sequence}`)) sequence += 1;
    patchExtensions({
      extraMcpServers: [...draft.extensions.extraMcpServers, {
        name: `mcp-server-${sequence}`,
        command: '',
        args: [],
        cwd: '',
        type: '',
        env: {},
      }],
    });
  }

  async function save(): Promise<void> {
    const invalid = draft.extensions.extraMcpServers.find((server) => server.name.trim().length === 0 || server.command.trim().length === 0);
    if (invalid !== undefined) {
      setError(locale === 'th' ? 'MCP Server ที่เพิ่มเองต้องมี Name และ Command' : 'Every custom MCP server needs a Name and Command.');
      return;
    }
    const names = draft.extensions.extraMcpServers.map((server) => server.name.trim().toLowerCase());
    if (new Set(names).size !== names.length) {
      setError(locale === 'th' ? 'ชื่อ MCP Server ห้ามซ้ำกัน' : 'MCP server names must be unique.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const restartRequired = await onSave(draft);
      setDirty(false);
      setMessage(restartRequired
        ? (locale === 'th' ? 'บันทึกแล้ว — ค่าบางส่วนจะใช้หลัง Restart MCP/Tunnel หรือเปิดโปรแกรมใหม่' : 'Saved — some settings apply after MCP/Tunnel or app restart.')
        : (locale === 'th' ? 'บันทึกการตั้งค่าเรียบร้อยแล้ว' : 'Settings saved.'));
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : (locale === 'th' ? 'บันทึกการตั้งค่าไม่สำเร็จ' : 'Could not save settings.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <section className="panel settings-card" aria-label="Application and updates">
        <div className="section-heading">
          <div className="unrestricted-title-wrap">
            <span className="settings-icon">⚙️</span>
            <div>
              <h2 className="settings-card-title">{locale === 'th' ? 'พฤติกรรมโปรแกรมและอัปเดต' : 'Application & Updates'}</h2>
              <span className="page-subtitle">Desktop behavior without manual config</span>
            </div>
          </div>
          <span className={`pill-badge ${dirty ? 'gold' : ''}`}>{dirty ? (locale === 'th' ? 'ยังไม่บันทึก' : 'Unsaved') : (locale === 'th' ? 'บันทึกแล้ว' : 'Saved')}</span>
        </div>
        <div className="tunnel-config-grid">
          <div>
            <label className="field-label" htmlFor="close-behavior">{locale === 'th' ? 'เมื่อกด X ปิดหน้าต่าง' : 'When closing the window'}</label>
            <select id="close-behavior" className="settings-select" value={draft.closeBehavior} onChange={(event) => patch({ closeBehavior: event.target.value === 'quit' ? 'quit' : 'tray' })}>
              <option value="tray">{locale === 'th' ? 'ซ่อนไปที่ System Tray' : 'Hide to system tray'}</option>
              <option value="quit">{locale === 'th' ? 'ออกจาก lnwjud' : 'Quit lnwjud'}</option>
            </select>
          </div>
          <div className="settings-toggle-stack">
            <Check label={locale === 'th' ? 'เปิด lnwjud พร้อม Windows' : 'Start lnwjud with Windows'} checked={draft.launchAtStartup} onChange={(value) => patch({ launchAtStartup: value })} />
            <Check label={locale === 'th' ? 'เปิดแบบซ่อนใน Tray' : 'Start minimized to tray'} checked={draft.startMinimized} onChange={(value) => patch({ startMinimized: value })} />
          </div>
        </div>
        <div className="settings-grid settings-subgrid">
          <Check label={locale === 'th' ? 'ตรวจอัปเดตอัตโนมัติ' : 'Check updates automatically'} checked={draft.updateAutoCheck} onChange={(value) => patch({ updateAutoCheck: value })} />
          <Check label={locale === 'th' ? 'ตรวจหลังเปิดโปรแกรม' : 'Check shortly after startup'} checked={draft.updateCheckOnStartup} onChange={(value) => patch({ updateCheckOnStartup: value })} />
          <Check label={locale === 'th' ? 'ดาวน์โหลดอัปเดตอัตโนมัติ' : 'Download updates automatically'} checked={draft.updateAutoDownload} onChange={(value) => patch({ updateAutoDownload: value })} />
          <NumberField label={locale === 'th' ? 'ช่วงตรวจอัปเดต (นาที)' : 'Update interval (minutes)'} value={draft.updateIntervalMinutes} min={5} max={1440} onChange={(value) => patch({ updateIntervalMinutes: value })} />
        </div>
      </section>

      <section className="panel settings-card" aria-label="Tools and timeouts">
        <div className="section-heading"><h2 className="settings-card-title"><span className="settings-icon">⏱️</span>{locale === 'th' ? 'Tools, Timeout และ Local MCP' : 'Tools, Timeouts & Local MCP'}</h2></div>
        <div className="settings-grid settings-subgrid">
          <NumberField label={locale === 'th' ? 'External MCP Tool Timeout (วินาที)' : 'External MCP Tool Timeout (seconds)'} value={Math.round(draft.mcpCallTimeoutMs / 1000)} min={1} max={3600} onChange={(value) => patch({ mcpCallTimeoutMs: value * 1000 })} />
          <NumberField label={locale === 'th' ? 'External MCP Idle Timeout (นาที)' : 'External MCP Idle Timeout (minutes)'} value={Math.round(draft.mcpIdleTimeoutMs / 60_000)} min={1} max={1440} onChange={(value) => patch({ mcpIdleTimeoutMs: value * 60_000 })} />
          <NumberField label={locale === 'th' ? 'Process Default Timeout (นาที)' : 'Process Default Timeout (minutes)'} value={Math.round(draft.processTimeoutMs / 60_000)} min={1} max={240} onChange={(value) => patch({ processTimeoutMs: value * 60_000 })} />
          <NumberField label="Local MCP HTTP Port" value={draft.mcpHttpPort} min={0} max={65535} onChange={(value) => patch({ mcpHttpPort: value })} />
        </div>
        <label className="field-label" htmlFor="capability-roots">{locale === 'th' ? 'Additional Capability Roots — หนึ่ง path ต่อบรรทัด' : 'Additional Capability Roots — one path per line'}</label>
        <textarea id="capability-roots" className="settings-textarea" rows={4} value={draft.capabilityRoots.join('\n')} placeholder={'D:\\Projects\nE:\\Work'} onChange={(event) => patch({ capabilityRoots: splitList(event.target.value) })} />
        <p className="hint">{locale === 'th' ? 'ใช้กับ Shell, Office, Screen Record และ WSL โดยไม่ต้องตั้ง LNWJUD_CAPABILITY_ROOTS เอง' : 'Used by Shell, Office, screen recording, and WSL without editing LNWJUD_CAPABILITY_ROOTS.'}</p>
      </section>

      <section className="panel settings-card" aria-label="Custom permissions">
        <div className="section-heading"><h2 className="settings-card-title"><span className="settings-icon">🔧</span>Custom Permission Profile</h2><span className="pill-badge gold">CUSTOM</span></div>
        <div className="settings-grid settings-subgrid">
          <Decision label="READ" value={draft.customPermission.read} onChange={(value) => patchCustom({ read: value })} />
          <Decision label="WRITE" value={draft.customPermission.write} onChange={(value) => patchCustom({ write: value })} />
          <Decision label="EXECUTE" value={draft.customPermission.execute} onChange={(value) => patchCustom({ execute: value })} />
          <Decision label="DANGEROUS" value={draft.customPermission.dangerous} onChange={(value) => patchCustom({ dangerous: value })} />
        </div>
        <label className="field-label" htmlFor="custom-executables">{locale === 'th' ? 'Allowed Executables เพิ่มเติม — หนึ่งรายการต่อบรรทัด' : 'Additional Allowed Executables — one per line'}</label>
        <textarea id="custom-executables" className="settings-textarea" rows={4} value={draft.customPermission.allowedExecutables.join('\n')} placeholder={'python.exe\ndocker.exe\ndotnet.exe'} onChange={(event) => patchCustom({ allowedExecutables: splitList(event.target.value) })} />
        <p className="hint">{locale === 'th' ? 'ใช้เมื่อเลือก Permission Profile = Custom ทั้ง Local MCP และ Secure Tunnel' : 'Used when Permission Profile = Custom for local MCP and Secure Tunnel.'}</p>
      </section>

      <section className="panel settings-card" aria-label="Tunnel reconnect">
        <div className="section-heading"><h2 className="settings-card-title"><span className="settings-icon">🔁</span>{locale === 'th' ? 'Tunnel Reconnect' : 'Tunnel Reconnect'}</h2></div>
        <div className="settings-grid settings-subgrid">
          <Check label={locale === 'th' ? 'เชื่อมต่อใหม่อัตโนมัติเมื่อ Tunnel หลุด' : 'Reconnect automatically when Tunnel exits'} checked={draft.tunnelAutoReconnect} onChange={(value) => patch({ tunnelAutoReconnect: value })} />
          <NumberField label={locale === 'th' ? 'จำนวนครั้งสูงสุดเมื่อหลุดถี่ ๆ' : 'Maximum rapid reconnect attempts'} value={draft.tunnelMaxAutoRestarts} min={0} max={50} onChange={(value) => patch({ tunnelMaxAutoRestarts: value })} />
        </div>
      </section>

      <section className="panel settings-card" aria-label="Extensions and MCP servers">
        <div className="section-heading">
          <div className="unrestricted-title-wrap"><span className="settings-icon">🧩</span><div><h2 className="settings-card-title">{locale === 'th' ? 'Extensions, Skills และ MCP Servers' : 'Extensions, Skills & MCP Servers'}</h2><span className="page-subtitle">No manual extensions JSON required</span></div></div>
          <button type="button" onClick={addServer}>+ {locale === 'th' ? 'เพิ่ม MCP Server' : 'Add MCP Server'}</button>
        </div>
        <div className="tunnel-config-grid">
          <div>
            <label className="field-label" htmlFor="extension-mode">External MCP mode</label>
            <select id="extension-mode" className="settings-select" value={draft.extensions.mode} onChange={(event) => patchExtensions({ mode: event.target.value === 'allowlist' ? 'allowlist' : 'enable_all' })}>
              <option value="enable_all">Enable all except disabled</option>
              <option value="allowlist">Allowlist only</option>
            </select>
          </div>
          <TextList label="Enabled Servers / Allowlist" value={draft.extensions.enabledServers} onChange={(value) => patchExtensions({ enabledServers: value })} />
          <TextList label="Disabled Servers" value={draft.extensions.disabledServers} onChange={(value) => patchExtensions({ disabledServers: value })} />
          <TextList label="Extra Skill Folders" value={draft.extensions.extraSkillRoots} onChange={(value) => patchExtensions({ extraSkillRoots: value })} />
          <TextList label="Disabled Skill Folders" value={draft.extensions.disabledSkillRoots} onChange={(value) => patchExtensions({ disabledSkillRoots: value })} />
        </div>
        <div className="mcp-server-settings-list">
          {draft.extensions.extraMcpServers.length === 0 ? <p className="hint">{locale === 'th' ? 'ยังไม่มี MCP Server ที่เพิ่มเอง; การค้นหาจาก Cursor / Claude Desktop ยังทำงานตามปกติ' : 'No custom MCP servers; Cursor / Claude Desktop discovery still works.'}</p> : null}
          {draft.extensions.extraMcpServers.map((server, index) => (
            <article className="mcp-server-settings-item" key={index}>
              <div className="section-heading"><strong>{server.name || `MCP Server ${index + 1}`}</strong><button type="button" onClick={() => patchExtensions({ extraMcpServers: draft.extensions.extraMcpServers.filter((_entry, current) => current !== index) })}>{locale === 'th' ? 'ลบ' : 'Remove'}</button></div>
              <div className="tunnel-config-grid">
                <Field label="Name" value={server.name} onChange={(value) => updateServer(index, { name: value })} />
                <Field label="Command" value={server.command} placeholder="npx.cmd" onChange={(value) => updateServer(index, { command: value })} />
                <Field label="Working directory" value={server.cwd} placeholder="optional" onChange={(value) => updateServer(index, { cwd: value })} />
                <Field label="Type" value={server.type} placeholder="optional (for example stdio)" onChange={(value) => updateServer(index, { type: value })} />
                <TextArea label="Args — one per line" value={server.args.join('\n')} onChange={(value) => updateServer(index, { args: splitLines(value) })} />
                <TextArea label="Environment — KEY=VALUE" value={envToText(server.env)} onChange={(value) => updateServer(index, { env: envFromText(value) })} />
              </div>
            </article>
          ))}
        </div>
        <p className="hint">{locale === 'th' ? 'Environment ของ MCP Server ถูกเก็บใน local settings; อย่าใส่ secret สำคัญในช่องนี้จนกว่าจะมี secret-store แยก' : 'MCP server environment values are stored in local settings; do not place important secrets here until a separate secret store is available.'}</p>
      </section>

      <div className="settings-save-bar">
        <div>{error === null ? null : <div className="alert-box-warning" role="alert">⚠️ {error}</div>}{message === null ? null : <div className="toast-success-banner" role="status">✨ {message}</div>}</div>
        <div className="inline-actions">
          <button type="button" disabled={!dirty || busy} onClick={() => { setDraft(effectiveSettings); setDirty(false); setError(null); setMessage(null); }}>{locale === 'th' ? 'ยกเลิกการแก้ไข' : 'Discard changes'}</button>
          <button type="button" className="btn-save-gold" disabled={!dirty || busy} onClick={() => { void save(); }}>{busy ? (locale === 'th' ? 'กำลังบันทึก…' : 'Saving…') : (locale === 'th' ? 'บันทึก Settings' : 'Save Settings')}</button>
        </div>
      </div>
    </>
  );
}

function Check({ label, checked, onChange }: { readonly label: string; readonly checked: boolean; readonly onChange: (value: boolean) => void }): ReactElement {
  return <label className="settings-inline-toggle"><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /><span>{label}</span></label>;
}

function NumberField({ label, value, min, max, onChange }: { readonly label: string; readonly value: number; readonly min: number; readonly max: number; readonly onChange: (value: number) => void }): ReactElement {
  return <div><label className="field-label">{label}</label><input type="number" value={value} min={min} max={max} onChange={(event) => onChange(clampNumber(event.target.value, value, min, max))} /></div>;
}

function Decision({ label, value, onChange }: { readonly label: string; readonly value: PermissionDecisionSetting; readonly onChange: (value: PermissionDecisionSetting) => void }): ReactElement {
  return <div><label className="field-label">{label}</label><select className="settings-select" value={value} onChange={(event) => onChange(event.target.value === 'ALLOW' || event.target.value === 'DENY' ? event.target.value : 'ASK')}><option value="ALLOW">ALLOW</option><option value="ASK">ASK</option><option value="DENY">DENY</option></select></div>;
}

function TextList({ label, value, onChange }: { readonly label: string; readonly value: readonly string[]; readonly onChange: (value: readonly string[]) => void }): ReactElement {
  return <TextArea label={label} value={value.join('\n')} onChange={(text) => onChange(splitList(text))} />;
}

function Field({ label, value, placeholder, onChange }: { readonly label: string; readonly value: string; readonly placeholder?: string; readonly onChange: (value: string) => void }): ReactElement {
  return <div><label className="field-label">{label}</label><input value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} /></div>;
}

function TextArea({ label, value, onChange }: { readonly label: string; readonly value: string; readonly onChange: (value: string) => void }): ReactElement {
  return <div><label className="field-label">{label}</label><textarea className="settings-textarea" rows={3} value={value} onChange={(event) => onChange(event.target.value)} /></div>;
}

function splitList(value: string): readonly string[] {
  return [...new Set(value.split(/[;\r\n]+/).map((entry) => entry.trim()).filter((entry) => entry.length > 0))];
}

function splitLines(value: string): readonly string[] {
  return value.split(/\r?\n/).map((entry) => entry.trim()).filter((entry) => entry.length > 0);
}

function envFromText(value: string): Readonly<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const line of value.split(/\r?\n/)) {
    const separator = line.indexOf('=');
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim();
    if (key.length > 0) result[key] = line.slice(separator + 1);
  }
  return result;
}

function envToText(value: Readonly<Record<string, string>>): string {
  return Object.entries(value).map(([key, entry]) => `${key}=${entry}`).join('\n');
}

function clampNumber(raw: string, fallback: number, min: number, max: number): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.round(parsed)));
}
