import type { UiLocale } from '@lnwjud/ipc-contracts';

export function unrestrictedSafetyBoundaryCopy(locale: UiLocale): string {
  return locale === 'th'
    ? 'เครื่องมือไฟล์แบบมีโครงสร้างใช้ Active Project แบบ canonical และ Recovery Trash / checkpoint. เมื่อ Full Bypass ปิด งานปกติของ Full Access จะไม่ถาม แต่ tool ที่ต้องยืนยันเสมอ งานลบ/ทำข้อมูลหาย คำสั่งอันตราย และการออกนอกขอบเขตยังใช้ policy เดิม; เมื่อเปิด Full Bypass จะข้ามการอนุมัติและขอบเขตระดับแอปทั้งหมด โดยข้อจำกัดจริงของ Windows/บริการภายนอกยังมีผล'
    : 'Structured file tools use canonical Active Project paths and Recovery Trash / checkpoints. With Full Bypass OFF, ordinary Full Access work does not prompt while always-confirm, destructive, and out-of-scope operations keep their normal policy. With Full Bypass ON, all lnwjud application approvals and scope checks are skipped; Windows and external-service boundaries still apply.';
}
