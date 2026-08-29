import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { DoctorReport, ResolvedRemediation, ToolCatalogItem } from '@lnwjud/ipc-contracts';
import { formatDateTime } from '../src/renderer/date-time.js';
import { DoctorPanel } from '../src/renderer/features/doctor/DoctorPanel.js';
import { ToolDetailModal } from '../src/renderer/features/tools/ToolDetailModal.js';

const checkedAt = new Date(2026, 7, 29, 18, 35, 13).toISOString();

const remediation: ResolvedRemediation = {
  id: 'configure_lsp',
  title: 'ตั้งค่า Language Server',
  explanation: 'ตั้งค่าคำสั่ง Language Server ภายในเครื่องอย่างน้อยหนึ่งรายการ',
  steps: ['ตั้งค่าคำสั่ง Language Server ภายในเครื่องอย่างน้อยหนึ่งรายการในหน้า Tools แล้วตรวจใหม่'],
  actions: [{ kind: 'open_settings', target: 'tools' }, { kind: 'recheck', requirementIds: ['configured_lsp'] }],
};

const tool: ToolCatalogItem = {
  name: 'db_inspect',
  origin: 'lnwjud',
  category: 'automation',
  title: 'DB Inspect · งานอัตโนมัติ',
  shortDescription: 'Inspect a database.',
  longDescription: 'Inspect a configured read-only database target.',
  declaredPermission: 'READ',
  profileDecision: 'ALLOW',
  riskMode: 'fixed',
  readiness: 'needs_setup',
  stale: false,
  checkedAt,
  supportsCancel: false,
  supportsDryRun: true,
  requirements: [{ id: 'database_target', status: 'warn', required: false, checkedAt, summaryKey: 'requirement.database_target', detail: 'Configure a target first.' }],
  remediationIds: [],
  inputSchema: null,
  searchText: ['db_inspect'],
};

const doctor: DoctorReport = {
  exitCode: 0,
  checks: [{
    id: 'configured_lsp',
    required: false,
    status: 'warn',
    title: 'ตรวจ configured_lsp',
    summary: 'WARN: requirement.configured_lsp',
    detail: 'No local language-server command is configured',
    affectedToolNames: ['lsp_diagnostics', 'lsp_rename'],
    remediationId: 'configure_lsp',
    checkedAt,
    durationMs: 862,
  }],
};

describe('Tools and Doctor UX', () => {
  it('renders readable tool facts without raw ISO timestamps or boolean literals', () => {
    const markup = renderToStaticMarkup(createElement(ToolDetailModal, {
      locale: 'th', item: tool, remediations: [], onClose: () => undefined, onRemediation: () => undefined,
    }));
    expect(markup).toContain(formatDateTime(checkedAt));
    expect(markup).not.toContain(checkedAt);
    expect(markup).toContain('ต้องตั้งค่า');
    expect(markup).toContain('ใช่');
    expect(markup).toContain('ไม่');
    expect(markup).toContain('tool-modal-close');
  });

  it('keeps Doctor remediation content in a dedicated block and preserves millisecond durations', () => {
    const markup = renderToStaticMarkup(createElement(DoctorPanel, {
      locale: 'th', report: doctor, remediations: [remediation],
      onRunDoctor: async () => undefined, onRecheck: async () => undefined, onRemediation: async () => undefined, onOpenProjects: () => undefined,
    }));
    expect(markup).toContain('doctor-remediation-copy');
    expect(markup).toContain('doctor-remediation-actions');
    expect(markup).toContain(formatDateTime(checkedAt));
    expect(markup).not.toContain(checkedAt);
    expect(markup).toContain('862 ms');
  });

  it('anchors the tool modal to document.body and constrains scrolling to the viewport-safe modal body', () => {
    const source = readFileSync(new URL('../src/renderer/features/tools/ToolDetailModal.tsx', import.meta.url), 'utf8');
    const styles = readFileSync(new URL('../src/renderer/styles.css', import.meta.url), 'utf8');
    expect(source).toContain("createPortal(modal, document.body)");
    expect(styles).toContain('z-index: 5000');
    expect(styles).toContain('align-items: flex-start');
    expect(styles).toContain('max-height: calc(100dvh - 64px)');
    expect(styles).toContain('.tool-modal-scroll { flex: 1 1 auto;');
  });
});
