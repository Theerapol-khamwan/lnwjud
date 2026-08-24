import console from 'node:console';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const targetVersion = process.argv[2];

async function updatePackageJson(filePath, newVersion) {
  const content = await readFile(filePath, 'utf8');
  const pkg = JSON.parse(content);
  pkg.version = newVersion;
  await writeFile(filePath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
  console.log(`Updated ${path.relative(rootDir, filePath)} -> ${newVersion}`);
}

async function syncAllVersions() {
  const rootPkgPath = path.join(rootDir, 'package.json');
  const rootPkg = JSON.parse(await readFile(rootPkgPath, 'utf8'));
  const version = targetVersion || rootPkg.version;
  const name = rootPkg.name || 'lnwjud';

  console.log(`Synchronizing single source of truth for name "${name}" and version "${version}"...`);

  // 1. Root package.json
  await updatePackageJson(rootPkgPath, version);

  // 2. Apps package.json
  const appsDir = path.join(rootDir, 'apps');
  const appEntries = await readdir(appsDir, { withFileTypes: true });
  for (const entry of appEntries) {
    if (entry.isDirectory()) {
      const pkgPath = path.join(appsDir, entry.name, 'package.json');
      try {
        await updatePackageJson(pkgPath, version);
      } catch {
        // skip if no package.json
      }
    }
  }

  // 3. Packages package.json
  const packagesDir = path.join(rootDir, 'packages');
  const packageEntries = await readdir(packagesDir, { withFileTypes: true });
  for (const entry of packageEntries) {
    if (entry.isDirectory()) {
      const pkgPath = path.join(packagesDir, entry.name, 'package.json');
      try {
        await updatePackageJson(pkgPath, version);
      } catch {
        // skip if no package.json
      }
    }
  }

  // 4. Update packages/ipc-contracts/src/index.ts
  const ipcContractsPath = path.join(rootDir, 'packages', 'ipc-contracts', 'src', 'index.ts');
  let ipcContractsContent = await readFile(ipcContractsPath, 'utf8');
  ipcContractsContent = ipcContractsContent
    .replace(/export const APP_NAME = ['"][^'"]+['"];/, `export const APP_NAME = '${name}';`)
    .replace(/export const APP_VERSION = ['"][^'"]+['"];/, `export const APP_VERSION = '${version}';`);
  await writeFile(ipcContractsPath, ipcContractsContent, 'utf8');
  console.log(`Updated packages/ipc-contracts/src/index.ts -> ${name} v${version}`);

  // 5. Update packages/shared/src/index.ts
  const sharedPath = path.join(rootDir, 'packages', 'shared', 'src', 'index.ts');
  let sharedContent = await readFile(sharedPath, 'utf8');
  sharedContent = sharedContent
    .replace(/export const APP_NAME = ['"][^'"]+['"];/, `export const APP_NAME = '${name}';`)
    .replace(/export const APP_VERSION = ['"][^'"]+['"];/, `export const APP_VERSION = '${version}';`);
  await writeFile(sharedPath, sharedContent, 'utf8');
  console.log(`Updated packages/shared/src/index.ts -> ${name} v${version}`);

  // 6. Update tests/packaging/desktop-packaging.test.ts
  const testPackagingPath = path.join(rootDir, 'tests', 'packaging', 'desktop-packaging.test.ts');
  try {
    let testContent = await readFile(testPackagingPath, 'utf8');
    testContent = testContent
      .replace(/pins the product release to v[0-9.]+/g, `pins the product release to v${version}`)
      .replace(/expect\(rootPackage\.version\)\.toBe\(['"][^'"]+['"]\);/g, `expect(rootPackage.version).toBe('${version}');`)
      .replace(/expect\(desktopPackage\.version\)\.toBe\(['"][^'"]+['"]\);/g, `expect(desktopPackage.version).toBe('${version}');`);
    await writeFile(testPackagingPath, testContent, 'utf8');
    console.log(`Updated tests/packaging/desktop-packaging.test.ts -> v${version}`);
  } catch {
    // skip if missing
  }

  // 7. Update README.md installer references
  const readmePath = path.join(rootDir, 'README.md');
  try {
    let readmeContent = await readFile(readmePath, 'utf8');
    readmeContent = readmeContent
      .replace(/lnwjud-Setup-[0-9.]+\.exe/g, `lnwjud-Setup-${version}.exe`)
      .replace(/## Current release: v[0-9.]+/g, `## Current release: v${version}`)
      .replace(/current published installer and runtime contract are `v[0-9.]+`/g, 'current published installer and runtime contract are `v' + version + '`')
      .replace(/The v[0-9.]+ release target and runtime contract/g, 'The v' + version + ' release target and runtime contract')
      .replace(/current v[0-9.]+ `ToolRegistry`/g, 'current v' + version + ' `ToolRegistry`')
      .replace(/## v[0-9.]+ release status/g, `## v${version} release status`)
      .replace(/Release `v[0-9.]+`/g, `Release \`v${version}\``);
    await writeFile(readmePath, readmeContent, 'utf8');
    console.log(`Updated README.md -> v${version}`);
  } catch {
    // skip if missing
  }

  console.log(`\nAll versions successfully synchronized to ${name} v${version}!`);
}

void syncAllVersions();
