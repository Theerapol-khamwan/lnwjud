import { useEffect, useRef, type ReactElement } from 'react';
import type { ResolvedRemediation, ToolCatalogItem, UiLocale } from '@lnwjud/ipc-contracts';
import { formatDateTime } from '../../date-time.js';

interface ToolDetailModalProps {
  readonly locale: UiLocale;
  readonly item: ToolCatalogItem;
  readonly remediations: readonly ResolvedRemediation[];
  readonly onClose: () => void;
  readonly onRemediation: (action: ResolvedRemediation['actions'][number]) => void;
}

export function ToolDetailModal({ locale, item, remediations, onClose, onRemediation }: ToolDetailModalProps): ReactElement {
  const dialogRef = useRef<HTMLElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    titleRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); return; }
      if (event.key !== 'Tab') return;
      const dialog = dialogRef.current;
      if (dialog === null) return;
      const focusable = [...dialog.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])')]
        .filter((element) => !element.hasAttribute('hidden'));
      if (focusable.length === 0) { event.preventDefault(); titleRef.current?.focus(); return; }
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKeyDown);
    return (): void => { document.removeEventListener('keydown', onKeyDown); previous?.focus(); };
  }, [onClose]);

  const relevantRemediations = remediations.filter((remediation) => item.remediationIds.includes(remediation.id));
  const notChecked = locale === 'th' ? 'ยังไม่มีผลตรวจ' : 'Not checked';
  return (
    <div className="tool-modal-backdrop" role="presentation" onMouseDown={(event): void => { if (event.currentTarget === event.target) onClose(); }}>
      <section ref={dialogRef} className="tool-modal" role="dialog" aria-modal="true" aria-labelledby="tool-detail-title">
        <header className="tool-modal-header">
          <div className="tool-modal-title-copy">
            <p className="eyebrow">{item.origin === 'external_mcp' ? `MCP · ${item.serverName ?? ''}` : 'lnwjud'}</p>
            <div className="tool-modal-title-line">
              <h2 ref={titleRef} tabIndex={-1} id="tool-detail-title">{item.title}</h2>
              <span className={`tool-readiness-badge tool-readiness-${item.readiness}`}>{readinessLabel(locale, item.readiness)}</span>
            </div>
            <code>{item.name}</code>
          </div>
          <button ref={closeRef} className="tool-modal-close" type="button" onClick={onClose} aria-label={locale === 'th' ? 'ปิดรายละเอียดเครื่องมือ' : 'Close tool details'}>×</button>
        </header>
        <div className="tool-modal-scroll">
          <p className="tool-modal-description">{item.longDescription}</p>
          <dl className="tool-facts">
            <div><dt>{locale === 'th' ? 'สถานะ' : 'Status'}</dt><dd><span className={`tool-readiness-badge tool-readiness-${item.readiness}`}>{readinessLabel(locale, item.readiness)}</span></dd></div>
            <div><dt>{locale === 'th' ? 'สิทธิ์ที่ประกาศ' : 'Declared permission'}</dt><dd>{item.declaredPermission}</dd></div>
            <div><dt>{locale === 'th' ? 'ผลจากโปรไฟล์' : 'Profile decision'}</dt><dd>{item.profileDecision}</dd></div>
            <div><dt>{locale === 'th' ? 'ความเสี่ยง' : 'Risk mode'}</dt><dd>{item.riskMode}</dd></div>
            <div><dt>{locale === 'th' ? 'ตรวจล่าสุด' : 'Checked at'}</dt><dd>{formatDateTime(item.checkedAt, notChecked)}</dd></div>
            <div><dt>{locale === 'th' ? 'ข้อมูลเก่า' : 'Stale'}</dt><dd>{booleanLabel(locale, item.stale)}</dd></div>
            <div><dt>{locale === 'th' ? 'ยกเลิกได้' : 'Cancelable'}</dt><dd>{nullableBooleanLabel(locale, item.supportsCancel)}</dd></div>
            <div><dt>Dry run</dt><dd>{nullableBooleanLabel(locale, item.supportsDryRun)}</dd></div>
          </dl>
          {item.riskMode === 'input_dependent' ? <p role="note" className="tool-risk-caveat">{locale === 'th' ? 'ระดับความเสี่ยงและการขออนุมัติอาจเปลี่ยนตาม operation และ arguments ที่ระบุ ไม่ได้หมายความว่าทุก operation มีระดับเดียวกัน' : 'Risk and approval requirements can change with the selected operation and arguments; not every operation has the same risk level.'}</p> : null}
          {item.stale ? <p role="status" className="tool-stale-caveat">{locale === 'th' ? 'ผล readiness นี้เกินอายุ cache แล้ว ควรตรวจใหม่ก่อนพึ่งพาสถานะ' : 'This readiness result is stale; recheck before relying on it.'}</p> : null}
          {item.requirements.length > 0 ? <section className="tool-modal-section"><h3>{locale === 'th' ? 'ข้อกำหนด' : 'Requirements'}</h3><ul className="tool-requirement-list">{item.requirements.map((requirement) => <li key={requirement.id}><div><strong>{requirement.id}</strong><span className={`doctor-status-badge doctor-status-${requirement.status}`}>{requirement.status}</span></div>{requirement.detail ? <p>{requirement.detail}</p> : null}</li>)}</ul></section> : null}
          {item.inputSchema !== null ? <details className="tool-schema-details"><summary>{locale === 'th' ? 'Input schema' : 'Input schema'}</summary><pre>{JSON.stringify(item.inputSchema, null, 2)}</pre></details> : null}
          {relevantRemediations.map((remediation) => <section key={remediation.id} className="tool-remediation"><h3>{remediation.title}</h3><p>{remediation.explanation}</p><ol>{remediation.steps.map((step) => <li key={step}>{step}</li>)}</ol><div className="tool-action-row">{remediation.actions.map((action, index) => <button type="button" key={`${remediation.id}-${index}`} onClick={() => onRemediation(action)}>{actionLabel(locale, action)}</button>)}</div></section>)}
        </div>
      </section>
    </div>
  );
}

function readinessLabel(locale: UiLocale, readiness: ToolCatalogItem['readiness']): string {
  const labels: Record<ToolCatalogItem['readiness'], readonly [string, string]> = {
    ready: ['พร้อม', 'Ready'],
    needs_setup: ['ต้องตั้งค่า', 'Needs setup'],
    blocked: ['ถูกบล็อก', 'Blocked'],
    disabled: ['ปิดใช้งาน', 'Disabled'],
    unsupported: ['ไม่รองรับ', 'Unsupported'],
    unknown: ['ไม่ทราบ', 'Unknown'],
  };
  return labels[readiness][locale === 'th' ? 0 : 1];
}

function booleanLabel(locale: UiLocale, value: boolean): string {
  return value ? (locale === 'th' ? 'ใช่' : 'Yes') : (locale === 'th' ? 'ไม่' : 'No');
}

function nullableBooleanLabel(locale: UiLocale, value: boolean | null): string {
  return value === null ? (locale === 'th' ? 'ไม่ทราบ' : 'Unknown') : booleanLabel(locale, value);
}

function actionLabel(locale: UiLocale, action: ResolvedRemediation['actions'][number]): string {
  if (action.kind === 'recheck') return locale === 'th' ? 'ตรวจใหม่' : 'Recheck';
  if (action.kind === 'open_settings') return locale === 'th' ? 'เปิดการตั้งค่า' : 'Open settings';
  if (action.kind === 'open_official_url') return locale === 'th' ? 'เปิดเว็บทางการ' : 'Open official site';
  return locale === 'th' ? 'คัดลอกคำสั่ง' : 'Copy command';
}
