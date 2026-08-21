import type { UiLocale, UpdateStatus } from '@lnwjud/ipc-contracts';

export interface NativeMessages {
  readonly trayOpen: string;
  readonly trayCheckUpdates: string;
  readonly trayQuit: string;
  readonly trayTooltip: string;
  readonly updaterUnavailablePackagedOnly: string;
  readonly updaterCheckTitle: string;
  readonly updaterUnavailable: string;
  readonly updaterAlreadyChecking: string;
  readonly updaterChecking: string;
  readonly updaterCheckFailed: string;
  readonly updaterInstallWaiting: string;
  readonly updaterAvailableTitle: string;
  readonly ok: string;
  readonly shutdownBlockedTitle: string;
  readonly shutdownBlockedMessage: string;
  updateAvailableStatus(version: string): string;
  updateAvailableDialog(version: string): string;
  updateDownloadingStatus(version: string | null, percent: number | null): string;
  updateCurrentStatus(version: string): string;
  updateCurrentDialog(version: string): string;
  updateReadyStatus(version: string): string;
  trayInstall(version: string): string;
  trayPreparing(version: string): string;
  trayDownloading(version: string, percent: number | null): string;
}

const th: NativeMessages = {
  trayOpen: 'เปิดหน้า',
  trayCheckUpdates: 'ตรวจอัปเดต',
  trayQuit: 'ปิดโปรแกรม',
  trayTooltip: 'lnwjud — ทำงานเบื้องหลัง',
  updaterUnavailablePackagedOnly: 'ระบบอัปเดตทำงานในแอปที่ติดตั้งจาก Release',
  updaterCheckTitle: 'ตรวจอัปเดต - lnwjud',
  updaterUnavailable: 'การตรวจอัปเดตจะทำงานเมื่อใช้แอปที่ติดตั้งจาก Release แล้ว',
  updaterAlreadyChecking: 'กำลังตรวจอัปเดตอยู่ กรุณารอผลการตรวจสอบ',
  updaterChecking: 'กำลังตรวจหาเวอร์ชันใหม่…',
  updaterCheckFailed: 'ไม่สามารถตรวจอัปเดตได้',
  updaterInstallWaiting: 'กำลังรอให้งานที่ใช้งานอยู่เสร็จก่อนรีสตาร์ตเพื่อติดตั้ง…',
  updaterAvailableTitle: 'พบอัปเดต - lnwjud',
  ok: 'ตกลง',
  shutdownBlockedTitle: 'lnwjud ยังทำงานอยู่',
  shutdownBlockedMessage: 'ยังยืนยันไม่ได้ว่า Tunnel ที่ lnwjud ดูแลหยุดทำงานแล้ว โปรแกรมจะยังเปิดอยู่ กรุณาตรวจสอบสถานะ Tunnel แล้วลองปิดโปรแกรมอีกครั้ง',
  updateAvailableStatus: (version) => `พบ v${version} — กำลังดาวน์โหลดในเบื้องหลัง`,
  updateAvailableDialog: (version) => `พบ lnwjud v${version} กำลังดาวน์โหลดอัปเดตในเบื้องหลัง`,
  updateDownloadingStatus: (_version, percent) => `กำลังดาวน์โหลดอัปเดต ${Math.round(percent ?? 0)}%`,
  updateCurrentStatus: (version) => `v${version} เป็นเวอร์ชันล่าสุดแล้ว`,
  updateCurrentDialog: (version) => `lnwjud v${version} เป็นเวอร์ชันล่าสุดแล้ว`,
  updateReadyStatus: (version) => `v${version} พร้อมติดตั้ง — กดที่เวอร์ชันมุมซ้ายบนเพื่ออัปเดต`,
  trayInstall: (version) => `ติดตั้งอัปเดต v${version}`,
  trayPreparing: (version) => `กำลังเตรียมติดตั้ง v${version}`,
  trayDownloading: (version, percent) => `กำลังดาวน์โหลด v${version}${percent === null ? '' : ` ${Math.round(percent)}%`}`,
};

const en: NativeMessages = {
  trayOpen: 'Open lnwjud',
  trayCheckUpdates: 'Check for Updates',
  trayQuit: 'Quit',
  trayTooltip: 'lnwjud — running in background',
  updaterUnavailablePackagedOnly: 'Updates are available in an installed Release build',
  updaterCheckTitle: 'Check for Updates - lnwjud',
  updaterUnavailable: 'Update checks are available after installing a Release build',
  updaterAlreadyChecking: 'An update check is already running. Please wait for it to finish.',
  updaterChecking: 'Checking for a newer version…',
  updaterCheckFailed: 'Unable to check for updates',
  updaterInstallWaiting: 'Waiting for active work to finish before restarting to install…',
  updaterAvailableTitle: 'Update Available - lnwjud',
  ok: 'OK',
  shutdownBlockedTitle: 'lnwjud is still running',
  shutdownBlockedMessage: 'The owned tunnel could not be confirmed stopped. lnwjud will remain open; check the tunnel status and retry Quit.',
  updateAvailableStatus: (version) => `v${version} found — downloading in the background`,
  updateAvailableDialog: (version) => `lnwjud v${version} is available and is downloading in the background`,
  updateDownloadingStatus: (_version, percent) => `Downloading update ${Math.round(percent ?? 0)}%`,
  updateCurrentStatus: (version) => `v${version} is up to date`,
  updateCurrentDialog: (version) => `lnwjud v${version} is up to date`,
  updateReadyStatus: (version) => `v${version} is ready — click the version badge in the top-left to update`,
  trayInstall: (version) => `Install update v${version}`,
  trayPreparing: (version) => `Preparing install v${version}`,
  trayDownloading: (version, percent) => `Downloading v${version}${percent === null ? '' : ` ${Math.round(percent)}%`}`,
};

export function nativeMessages(locale: UiLocale): NativeMessages {
  return locale === 'en' ? en : th;
}

export function localizedUpdateStatusMessage(status: UpdateStatus, locale: UiLocale): string | null {
  const messages = nativeMessages(locale);
  const version = status.availableVersion;
  switch (status.phase) {
    case 'unavailable': return messages.updaterUnavailablePackagedOnly;
    case 'checking': return messages.updaterChecking;
    case 'available': return version === null ? messages.updaterChecking : messages.updateAvailableStatus(version);
    case 'downloading': return messages.updateDownloadingStatus(version, status.progressPercent);
    case 'ready': return version === null ? status.message : messages.updateReadyStatus(version);
    case 'installing': return messages.updaterInstallWaiting;
    case 'up-to-date': return messages.updateCurrentStatus(status.currentVersion);
    case 'idle': return null;
    case 'error': return status.message;
  }
}
