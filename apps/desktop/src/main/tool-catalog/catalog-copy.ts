import type { UiLocale } from '@lnwjud/ipc-contracts';
import { catalogDefinitions, catalogSourceDescriptions } from './catalog-definitions.js';

const CATEGORY_LABELS: Readonly<Record<string, Readonly<Record<UiLocale, string>>>> = Object.freeze({
  workspace: { en: 'Workspace', th: 'พื้นที่ทำงาน' },
  files: { en: 'Files', th: 'ไฟล์' },
  search_context: { en: 'Search & Context', th: 'ค้นหาและบริบท' },
  git: { en: 'Git', th: 'Git' },
  process: { en: 'Processes & Development', th: 'โปรเซสและงานพัฒนา' },
  browser_desktop: { en: 'Browser & Desktop', th: 'เบราว์เซอร์และเดสก์ท็อป' },
  system: { en: 'System', th: 'ระบบ' },
  office_media: { en: 'Office & Media', th: 'Office และสื่อ' },
  automation: { en: 'Automation', th: 'งานอัตโนมัติ' },
  agent_goals: { en: 'Agent & Goals', th: 'เอเจนต์และเป้าหมาย' },
  extensions: { en: 'Extensions', th: 'ส่วนขยาย' },
});

export function resolveCatalogCopy(locale: UiLocale, key: string): string {
  const match = /^tool\.([A-Za-z0-9_]+)\.(title|short|long)$/.exec(key);
  if (match === null) return '';
  const name = match[1];
  const field = match[2];
  if (name === undefined || field === undefined) return '';
  const definition = catalogDefinitions[name];
  if (definition === undefined) return '';
  const description = catalogSourceDescriptions[name]?.trim() ?? '';
  const title = humanizeToolName(name);
  const category = CATEGORY_LABELS[definition.category]?.[locale] ?? definition.category;

  if (field === 'title') return locale === 'th' ? `${title} · ${category}` : title;
  if (field === 'short') {
    return locale === 'th'
      ? `เครื่องมือ ${title} สำหรับ ${description || 'การทำงานตามสัญญาของระบบ lnwjud'}`
      : description || `${title} tool.`;
  }
  return locale === 'th'
    ? `ใช้ ${title} ในหมวด ${category} ตามสัญญา runtime ของ lnwjud: ${description || 'การทำงานของเครื่องมือนี้ขึ้นอยู่กับความพร้อมของ runtime และสิทธิ์ที่เกี่ยวข้อง'}`
    : `${description || `${title} follows the lnwjud runtime contract.`} Category: ${category}. Availability still depends on runtime readiness, requirements, and the active permission profile.`;
}

function humanizeToolName(name: string): string {
  return name
    .split('_')
    .filter(Boolean)
    .map((part) => part.length <= 3 ? part.toUpperCase() : `${part[0]?.toUpperCase() ?? ''}${part.slice(1)}`)
    .join(' ');
}
