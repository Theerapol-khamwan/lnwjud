import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const desktopRoot = path.resolve(import.meta.dirname, '..', '..', 'apps', 'desktop');
const repositoryRoot = path.resolve(desktopRoot, '..', '..');

describe('Windows desktop packaging', () => {
  it('pins the product release to v4.5.0', async () => {
    const rootPackage = JSON.parse(await readFile(path.join(repositoryRoot, 'package.json'), 'utf8')) as { version?: unknown };
    const desktopPackage = JSON.parse(await readFile(path.join(desktopRoot, 'package.json'), 'utf8')) as { version?: unknown };
    expect(rootPackage.version).toBe('4.5.0');
    expect(desktopPackage.version).toBe('4.5.0');
  });

  it('publishes complete desktop application metadata', async () => {
    const desktopPackage = JSON.parse(await readFile(path.join(desktopRoot, 'package.json'), 'utf8')) as {
      description?: unknown;
      author?: unknown;
      homepage?: unknown;
      repository?: { type?: unknown; url?: unknown };
    };

    expect(desktopPackage.description).toBe('Windows-first local AI-agent runtime and MCP gateway with 210 tools.');
    expect(desktopPackage.author).toBe('Adisorn');
    expect(desktopPackage.homepage).toBe('https://github.com/engasnm111/lnwjud#readme');
    expect(desktopPackage.repository).toEqual({ type: 'git', url: 'https://github.com/engasnm111/lnwjud.git' });
  });

  it('declares lnwjud x64 NSIS packaging and built runtime bundles', async () => {
    const configPath = path.join(desktopRoot, 'electron-builder.yml');
    const config = await readFile(configPath, 'utf8');

    expect(config).toContain('productName: lnwjud');
    expect(config).toContain('output: dist/installers');
    expect(config).toContain('target: nsis');
    expect(config).toContain('- x64');
    expect(config).toContain('icon: build/icon.ico');
    expect(config).toContain('signAndEditExecutable: true');
    expect(config).not.toContain('signAndEditExecutable: false');
    expect(config).toContain('createStartMenuShortcut: false');
    expect(config).not.toMatch(/[A-Z]:\\Users\\[^\r\n]+/i);
    const installerScript = await readFile(path.join(desktopRoot, 'build', 'installer.nsh'), 'utf8');
    expect(installerScript).toContain('CreateShortCut "$SMPROGRAMS\\lnwjud.lnk" "$INSTDIR\\lnwjud.exe"');
    expect(installerScript).toContain('SetOutPath "$INSTDIR"');
    expect(installerScript).not.toMatch(/[A-Z]:\\Users\\[^\r\n]+/i);
    expect(config).toContain('extraResources:');
    expect(config).toContain('windows-capability-bridge.ps1');
    await access(path.join(desktopRoot, 'dist', 'main', 'main.js'));
    await access(path.join(desktopRoot, 'dist', 'preload', 'index.cjs'));
    await access(path.join(desktopRoot, 'dist', 'renderer', 'index.html'));

    const mainBundle = await readFile(path.join(desktopRoot, 'dist', 'main', 'main.js'), 'utf8');
    expect(mainBundle).toContain('webSecurity: true');
    expect(mainBundle).not.toContain('webSecurity: false');
    expect(mainBundle).toMatch(/setName\(["']lnwjud["']|setName\(APP_NAME\)/);
    expect(mainBundle).toContain('LNWJUD_DATA_PATH');
    expect(mainBundle).toContain('LNWJUD_UNRESTRICTED');
    expect(mainBundle).toContain('setPath("userData"');
  });
});
