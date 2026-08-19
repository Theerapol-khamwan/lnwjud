import { describe, expect, it } from 'vitest';
import { ok, type Result } from '@lnwjud/domain';
import type { CapabilityBackend } from './local-capability-service.js';
import { VisionCapabilityBackend, WindowsOcrCapabilityBackend } from './windows-ocr-backend.js';

describe('WindowsOcrCapabilityBackend', () => {
  it('returns a truthful unavailable state when WinRT package identity is absent', async () => {
    const backend = new WindowsOcrCapabilityBackend({ platform: 'win32' });

    await expect(backend.execute({ action: 'ocr', text: 'hello' })).resolves.toMatchObject({ ok: true, value: {
      available: false,
      ready: false,
      backend: 'Windows.Media.Ocr',
      reason: 'package_identity_required',
    } });
  });

  it('delegates OCR only after identity is verified and keeps vision capture on the existing backend', async () => {
    const calls: unknown[] = [];
    const helper = {
      execute: async (input: unknown): Promise<Result<unknown>> => { calls.push(input); return ok({ text: 'สวัสดี hello', lines: [] }); },
    };
    const native: CapabilityBackend = { execute: async (input): Promise<Result<unknown>> => ok({ native: input }) };
    const ocr = new WindowsOcrCapabilityBackend({
      platform: 'win32',
      packageIdentity: async (): Promise<Result<boolean>> => ok(true),
      helper,
    });
    const vision = new VisionCapabilityBackend(native, ocr);

    await expect(vision.execute({ action: 'ocr', image_base64: 'cG5n' })).resolves.toMatchObject({ ok: true, value: { text: 'สวัสดี hello' } });
    await expect(vision.execute({ action: 'capture_display' })).resolves.toMatchObject({ ok: true, value: { native: { action: 'capture_display' } } });
    expect(calls).toEqual([{ action: 'ocr', image_base64: 'cG5n' }]);
  });

  it('reports helper readiness separately from package identity', async () => {
    const backend = new WindowsOcrCapabilityBackend({
      platform: 'win32',
      packageIdentity: async (): Promise<Result<boolean>> => ok(true),
    });

    await expect(backend.execute({ action: 'ocr' })).resolves.toMatchObject({ ok: true, value: {
      available: false,
      reason: 'native_helper_not_configured',
    } });
  });
});
