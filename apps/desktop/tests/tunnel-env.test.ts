import { describe, expect, it } from 'vitest';
import { tunnelClientEnv } from '../src/main/tunnel-controller.js';

describe('tunnelClientEnv', () => {
  it('points the MCP child at the desktop data path in unrestricted mode', () => {
    const env = tunnelClientEnv('key', 'C:/Users/me/AppData/Roaming/tunnel-client', 'C:/Users/me/AppData/Roaming/lnwjud');
    expect(env.LNWJUD_DATA_PATH).toBe('C:/Users/me/AppData/Roaming/lnwjud');
    expect(env.LNWJUD_UNRESTRICTED).toBe('1');
    expect(env.MCP_CONNECTION_MAX_TTL).toBe('168h0m0s');
  });
});
