import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_EXTENSIONS_SETTINGS } from './types.js';
import { SkillCatalog, parseSkillMarkdown } from './skill-catalog.js';

const temporaryRoots: string[] = [];

afterEach(async () => {
  const { rm } = await import('node:fs/promises');
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('SkillCatalog', () => {
  it('parses folded frontmatter descriptions', () => {
    const parsed = parseSkillMarkdown(`---
name: demo
description: >-
  First line
  Second line
---
# Body
`, 'fallback');
    expect(parsed).toEqual({ name: 'demo', description: 'First line Second line' });
  });

  it('lists and reads skills under configured roots', async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), 'lnwjud-skills-'));
    temporaryRoots.push(home);
    const skillRoot = path.join(home, '.cursor', 'skills-cursor', 'demo-skill');
    await mkdir(skillRoot, { recursive: true });
    await writeFile(path.join(skillRoot, 'SKILL.md'), `---
name: demo-skill
description: Demo skill for tests
---
# Demo
Do the thing.
`, 'utf8');
    await writeFile(path.join(skillRoot, 'notes.md'), 'extra notes\n', 'utf8');

    const catalog = new SkillCatalog({ homeDir: home, settings: DEFAULT_EXTENSIONS_SETTINGS });
    const listed = await catalog.list({ query: 'demo' });
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    expect(listed.value.skills).toEqual([
      expect.objectContaining({
        id: 'cursor-skills-cursor/demo-skill',
        name: 'demo-skill',
        source: 'cursor-skills-cursor',
      }),
    ]);

    const read = await catalog.read({ skillId: 'cursor-skills-cursor/demo-skill' });
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.value.content).toContain('Do the thing.');

    const relative = await catalog.read({ skillId: 'cursor-skills-cursor/demo-skill', relativePath: 'notes.md' });
    expect(relative.ok).toBe(true);
    if (!relative.ok) return;
    expect(relative.value.content).toContain('extra notes');

    const escape = await catalog.read({ skillId: 'cursor-skills-cursor/demo-skill', relativePath: '../outside.md' });
    expect(escape.ok).toBe(false);
  });

  it('discovers and reads workspace .agents skills by source-qualified id', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'lnwjud-workspace-skills-'));
    temporaryRoots.push(root);
    const home = path.join(root, 'home');
    const workspace = path.join(root, 'workspace');
    const skillRoot = path.join(workspace, '.agents', 'skills', 'lnwjud-scheduled-continuation');
    await mkdir(home, { recursive: true });
    await mkdir(skillRoot, { recursive: true });
    await writeFile(path.join(skillRoot, 'SKILL.md'), `---
name: lnwjud-scheduled-continuation
description: Continue a durable goal
---
# Scheduled continuation
Use one native successor.
`, 'utf8');

    const catalog = new SkillCatalog({
      homeDir: home,
      workspaceRoot: workspace,
      settings: DEFAULT_EXTENSIONS_SETTINGS,
    });
    const listed = await catalog.list({ query: 'scheduled continuation' });
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    expect(listed.value.skills).toEqual([
      expect.objectContaining({
        id: 'workspace-agents-skills/lnwjud-scheduled-continuation',
        name: 'lnwjud-scheduled-continuation',
        source: 'workspace-agents-skills',
      }),
    ]);

    const read = await catalog.read({ skillId: 'workspace-agents-skills/lnwjud-scheduled-continuation' });
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.value.content).toContain('Use one native successor.');
  });

  it('reads an unambiguous skill by bare or dollar-prefixed name', async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), 'lnwjud-skill-alias-'));
    temporaryRoots.push(home);
    const skillRoot = path.join(home, '.agents', 'skills', 'demo-alias');
    await mkdir(skillRoot, { recursive: true });
    await writeFile(path.join(skillRoot, 'SKILL.md'), `---
name: demo-alias
description: Alias test skill
---
Alias content.
`, 'utf8');

    const catalog = new SkillCatalog({ homeDir: home, settings: DEFAULT_EXTENSIONS_SETTINGS });
    const bare = await catalog.read({ skillId: 'demo-alias' });
    expect(bare.ok).toBe(true);
    if (!bare.ok) return;
    expect(bare.value.id).toBe('agents-skills/demo-alias');

    const dollarPrefixed = await catalog.read({ skillId: '$demo-alias' });
    expect(dollarPrefixed.ok).toBe(true);
    if (!dollarPrefixed.ok) return;
    expect(dollarPrefixed.value.id).toBe('agents-skills/demo-alias');
  });

  it('rejects ambiguous unqualified skill names with source-qualified candidates', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'lnwjud-ambiguous-skills-'));
    temporaryRoots.push(root);
    const home = path.join(root, 'home');
    const workspace = path.join(root, 'workspace');
    const globalSkillRoot = path.join(home, '.agents', 'skills', 'duplicate-skill');
    const workspaceSkillRoot = path.join(workspace, '.agents', 'skills', 'duplicate-skill');
    await mkdir(globalSkillRoot, { recursive: true });
    await mkdir(workspaceSkillRoot, { recursive: true });
    const content = `---
name: duplicate-skill
description: Duplicate skill
---
Duplicate content.
`;
    await writeFile(path.join(globalSkillRoot, 'SKILL.md'), content, 'utf8');
    await writeFile(path.join(workspaceSkillRoot, 'SKILL.md'), content, 'utf8');

    const catalog = new SkillCatalog({
      homeDir: home,
      workspaceRoot: workspace,
      settings: DEFAULT_EXTENSIONS_SETTINGS,
    });
    const read = await catalog.read({ skillId: 'duplicate-skill' });
    expect(read.ok).toBe(false);
    if (read.ok) return;
    expect(read.error.code).toBe('INVALID_INPUT');
    expect(read.error.message).toContain('agents-skills/duplicate-skill');
    expect(read.error.message).toContain('workspace-agents-skills/duplicate-skill');
  });
});
