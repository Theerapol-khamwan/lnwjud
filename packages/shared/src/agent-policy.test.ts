import { describe, expect, it } from 'vitest';
import { parseAllowedRoots, parseBooleanSetting, parseStdioPermissionProfile, serializeAllowedRoots } from './agent-policy.js';

describe('agent policy settings', () => {
  it('parses boolean settings with a fallback', () => {
    expect(parseBooleanSetting('true')).toBe(true);
    expect(parseBooleanSetting('0', true)).toBe(false);
    expect(parseBooleanSetting('unknown', true)).toBe(true);
  });

  it('parses stdio profiles without accepting unknown values', () => {
    expect(parseStdioPermissionProfile('safe')).toBe('safe');
    expect(parseStdioPermissionProfile('CUSTOM')).toBe('custom');
    expect(parseStdioPermissionProfile('unknown')).toBe('full');
  });

  it('parses and serializes distinct allowed roots', () => {
    expect(parseAllowedRoots('D:\\one;D:\\two\nD:\\ONE')).toEqual(['D:\\one', 'D:\\two']);
    expect(serializeAllowedRoots(['D:\\one', 'D:\\one', 'E:\\two'])).toBe('D:\\one;E:\\two');
  });
});
