import type { RemediationAction, ResolvedRemediation, UiLocale } from '@lnwjud/ipc-contracts';

interface RemediationDefinition {
  readonly id: string;
  readonly title: Readonly<Record<UiLocale, string>>;
  readonly explanation: Readonly<Record<UiLocale, string>>;
  readonly steps: Readonly<Record<UiLocale, readonly string[]>>;
  readonly actions: readonly RemediationAction[];
}

const DEFINITIONS: readonly RemediationDefinition[] = [
  remediation('add_project', 'Add a project', 'เพิ่มโปรเจกต์', 'Register and activate a project workspace.', 'ลงทะเบียนและเปิดใช้ project workspace', [{ kind: 'open_settings', target: 'projects' }]),
  remediation('install_git', 'Install Git', 'ติดตั้ง Git', 'Install Git from the official source and recheck.', 'ติดตั้ง Git จากแหล่งทางการแล้วตรวจใหม่', [{ kind: 'open_official_url', target: 'git_download' }, { kind: 'recheck', requirementIds: ['executable_git'] }]),
  remediation('install_ripgrep', 'Install ripgrep', 'ติดตั้ง ripgrep', 'Install ripgrep or use the bundled runtime, then recheck.', 'ติดตั้ง ripgrep หรือใช้ runtime ที่มากับโปรแกรมแล้วตรวจใหม่', [{ kind: 'open_official_url', target: 'ripgrep_releases' }, { kind: 'recheck', requirementIds: ['executable_ripgrep'] }]),
  remediation('configure_codex', 'Configure Codex', 'ตั้งค่า Codex', 'Enable and configure the optional Codex runtime only when you intend to use Codex tools.', 'เปิดและตั้งค่า Codex เฉพาะเมื่อคุณต้องการใช้เครื่องมือ Codex', [{ kind: 'open_settings', target: 'tools' }, { kind: 'recheck', requirementIds: ['codex_runtime'] }]),
  remediation('configure_tunnel', 'Configure secure tunnel', 'ตั้งค่า Secure Tunnel', 'Open Tunnel settings and complete the required identity/runtime setup.', 'เปิดการตั้งค่า Tunnel และตั้งค่าข้อมูลกับ runtime ให้ครบ', [{ kind: 'open_settings', target: 'tunnel' }, { kind: 'recheck', requirementIds: ['tunnel_runtime'] }]),
  remediation('connect_external_mcp', 'Connect external MCP', 'เชื่อมต่อ External MCP', 'Review external MCP server settings and reconnect the server.', 'ตรวจการตั้งค่า external MCP และเชื่อมต่อเซิร์ฟเวอร์ใหม่', [{ kind: 'open_settings', target: 'extensions' }, { kind: 'recheck', requirementIds: ['external_mcp_connection'] }]),
  remediation('recheck_runtime', 'Recheck runtime', 'ตรวจ runtime ใหม่', 'Run the safe readiness probe again.', 'รันการตรวจ readiness แบบ read-only อีกครั้ง', [{ kind: 'recheck', requirementIds: [] }]),
];

export const OFFICIAL_URL_TARGETS = Object.freeze({
  git_download: 'https://git-scm.com/download/win',
  ripgrep_releases: 'https://github.com/BurntSushi/ripgrep/releases',
} as const);

export const COPY_COMMANDS = Object.freeze({
  check_git: 'git --version',
  check_ripgrep: 'rg --version',
} as const);

export class RemediationRegistry {
  readonly #definitions = new Map(DEFINITIONS.map((definition) => [definition.id, definition] as const));

  public has(id: string): boolean { return this.#definitions.has(id); }
  public ids(): readonly string[] { return [...this.#definitions.keys()]; }
  public resolve(locale: UiLocale, ids: readonly string[] = this.ids()): readonly ResolvedRemediation[] {
    return [...new Set(ids)].map((id) => {
      const definition = this.#definitions.get(id);
      if (definition === undefined) throw new Error(`Unknown remediation id: ${id}`);
      return {
        id,
        title: definition.title[locale],
        explanation: definition.explanation[locale],
        steps: definition.steps[locale],
        actions: definition.actions,
      };
    });
  }
}

function remediation(id: string, enTitle: string, thTitle: string, enExplanation: string, thExplanation: string, actions: readonly RemediationAction[]): RemediationDefinition {
  return { id, title: { en: enTitle, th: thTitle }, explanation: { en: enExplanation, th: thExplanation }, steps: { en: [enExplanation], th: [thExplanation] }, actions };
}
