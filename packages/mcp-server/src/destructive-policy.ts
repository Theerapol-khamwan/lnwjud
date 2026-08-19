export interface DestructivePolicyDecision {
  readonly destructive: boolean;
  readonly reason?: string;
}

const GIT_DESTRUCTIVE_SUBCOMMANDS = new Set([
  'clean',
  'rm',
  'reset',
  'restore',
  'rebase',
  'prune',
]);


export function inspectDestructiveOperation(toolName: string, input: unknown): DestructivePolicyDecision {
  const value = asRecord(input);
  if (value === null) return { destructive: false };
  if (value.dry_run === true || value.dryRun === true) return { destructive: false };

  switch (toolName) {
    case 'delete_file':
      return destructive('filesystem deletion');
    case 'git':
      return inspectGit(value);
    case 'git_worktree_spawn':
      return destructive('creating an isolated Git worktree writes workspace state');
    case 'shell':
      return inspectShell(value);
    case 'wsl_exec':
      return inspectShell({ operation: value.operation, executable: value.executable, arguments: value.arguments });
    case 'process_start':
      return inspectShell({ operation: 'run', executable: value.executable, arguments: value.args });
    case 'codex_run':
      return destructive('delegated coding agent can mutate or delete workspace data');
    case 'dom_cdp':
      return inspectDomCdp(value);
    case 'web_fetch':
      return String(value.method ?? 'GET').toUpperCase() === 'DELETE'
        ? destructive('HTTP DELETE can remove remote data')
        : { destructive: false };
    case 'mcp_call':
      return destructive('child MCP side effects cannot be proven non-destructive at the gateway boundary');
    case 'scheduler':
      return value.action === 'delete' ? destructive('scheduled task deletion') : { destructive: false };
    case 'office':
      return value.action === 'write' || value.action === 'replace' || value.action === 'save_as'
        ? destructive('Office mutation can overwrite document data')
        : { destructive: false };
    case 'window':
      return value.operation === 'close' ? destructive('closing a window can discard unsaved data') : { destructive: false };
    case 'accessibility':
      if (['click', 'menu_select', 'select_item', 'close_window'].includes(String(value.action ?? ''))) {
        return destructive('opaque native UI action can trigger deletion or discard unsaved data');
      }
      return { destructive: false };
    case 'input_event':
      return inspectInputEvent(value);
    case 'ui_target_action':
      return ['click', 'set_value', 'select_item', 'menu_select'].includes(String(value.action ?? 'click'))
        ? destructive('marked native UI action can trigger opaque application side effects')
        : { destructive: false };
    case 'write_file':
      return value.content === '' ? destructive('empty write can truncate file data') : { destructive: false };
    case 'apply_patch': {
      const files = Array.isArray(value.files) ? value.files : [];
      return files.some((entry) => asRecord(entry)?.content === '')
        ? destructive('empty patch content can truncate file data')
        : { destructive: false };
    }
    case 'plugin_remove':
      return destructive('plugin removal deletes installed plugin state');
    case 'hook_remove':
      return destructive('hook removal deletes a registered hook');
    default:
      return { destructive: false };
  }
}

export function hasExplicitUserConfirmation(input: unknown): boolean {
  return asRecord(input)?.userConfirmed === true;
}

function inspectGit(value: Record<string, unknown>): DestructivePolicyDecision {
  const args = stringArray(value.args);
  if (args.length === 0) return { destructive: false };
  const subcommandIndex = args.findIndex((arg) => !arg.startsWith('-'));
  if (subcommandIndex < 0) return { destructive: false };
  const subcommand = args[subcommandIndex]!.toLowerCase();
  const restRaw = args.slice(subcommandIndex + 1);
  const rest = restRaw.map((arg) => arg.toLowerCase());

  if (GIT_DESTRUCTIVE_SUBCOMMANDS.has(subcommand)) return destructive(`git ${subcommand} can discard or delete data`);
  if (subcommand === 'checkout' && (rest.includes('-f') || rest.includes('--force') || rest.includes('--') || restRaw.includes('-B'))) {
    return destructive('git checkout can discard working-tree changes or reset a branch');
  }
  if (subcommand === 'switch' && (rest.includes('-f') || rest.includes('--force') || rest.includes('--discard-changes') || rest.includes('--force-create') || restRaw.includes('-C'))) {
    return destructive('git switch can discard working-tree changes or reset a branch');
  }
  if (subcommand === 'branch' && (rest.some((arg) => ['-d', '--delete', '-f', '--force'].includes(arg)) || restRaw.includes('-D'))) {
    return destructive('git branch can delete or force-move a branch');
  }
  if (subcommand === 'tag' && rest.some((arg) => ['-d', '--delete', '-f', '--force'].includes(arg))) return destructive('git tag can delete or replace a tag');
  if (subcommand === 'stash' && rest.some((arg) => ['pop', 'drop', 'clear'].includes(arg))) return destructive('git stash operation can remove stash data');
  if (subcommand === 'reflog' && rest.some((arg) => ['expire', 'delete'].includes(arg))) return destructive('git reflog operation can remove recovery history');
  if (subcommand === 'worktree' && rest.some((arg) => ['remove', 'prune'].includes(arg))) return destructive('git worktree removal');
  if (subcommand === 'push' && rest.some((arg) => arg === '--force' || arg.startsWith('--force-with-lease') || arg === '--delete' || arg === '-f')) {
    return destructive('git push can rewrite or delete remote history');
  }
  if (subcommand === 'commit' && rest.includes('--amend')) return destructive('git commit --amend rewrites history');
  return { destructive: false };
}

function inspectShell(value: Record<string, unknown>): DestructivePolicyDecision {
  if (value.operation !== undefined && value.operation !== 'run') return { destructive: false };
  const executable = basename(String(value.executable ?? '')).toLowerCase();
  const args = stringArray(value.arguments);
  const joined = args.join(' ').toLowerCase();

  if (executable === 'git' || executable === 'git.exe') return inspectGit({ args });
  if (['del', 'del.exe', 'erase', 'erase.exe', 'rm', 'rm.exe', 'rmdir', 'rmdir.exe', 'rd', 'rd.exe', 'unlink', 'unlink.exe'].includes(executable)) {
    return destructive(`${executable} deletes filesystem data`);
  }
  if (['powershell', 'powershell.exe', 'pwsh', 'pwsh.exe'].includes(executable)) {
    const withoutGitRm = joined.replace(/\bgit(?:\.exe)?\s+rm\b/g, ' ');
    if (/\b(remove-item|clear-content|rm|del)\b/i.test(withoutGitRm)) return destructive('PowerShell command can delete or truncate data');
    if (/\bset-content\b/i.test(joined) && !/\b-addcontent\b/i.test(joined)) return destructive('PowerShell Set-Content can overwrite data');
  }
  if (['cmd', 'cmd.exe'].includes(executable) && /(^|[\s&|])(del|erase|rd|rmdir)\b/i.test(joined)) {
    return destructive('cmd command deletes filesystem data');
  }
  if (['bash', 'bash.exe', 'sh', 'sh.exe'].includes(executable) && /(^|[;&|\s])(rm|unlink|rmdir|truncate)\b/i.test(joined)) {
    return destructive('shell command can delete or truncate filesystem data');
  }
  if (['node', 'node.exe'].includes(executable) && /\b(unlinksync|unlink|rmsync|rm|rmdirsync|rmdir|truncatesync|truncate)\s*\(/.test(joined)) {
    return destructive('Node script can delete or truncate filesystem data');
  }
  if (['python', 'python.exe', 'py', 'py.exe'].includes(executable) && /\b(os\.remove|os\.unlink|os\.rmdir|shutil\.rmtree|truncate)\b/.test(joined)) {
    return destructive('Python script can delete or truncate filesystem data');
  }
  if (executable.startsWith('robocopy') && args.some((arg) => ['/mir', '/purge'].includes(arg.toLowerCase()))) {
    return destructive('robocopy mirror/purge can delete destination data');
  }
  return { destructive: false };
}

function inspectDomCdp(value: Record<string, unknown>): DestructivePolicyDecision {
  const actions = new Set(['click', 'evaluate']);
  if (actions.has(String(value.action ?? ''))) return destructive('opaque browser action can trigger destructive remote or local side effects');
  const steps = Array.isArray(value.steps) ? value.steps : [];
  for (const step of steps) {
    const record = asRecord(step);
    if (record !== null && actions.has(String(record.action ?? ''))) {
      return destructive('batched browser action can trigger destructive remote or local side effects');
    }
  }
  return { destructive: false };
}

function inspectInputEvent(value: Record<string, unknown>): DestructivePolicyDecision {
  const operation = String(value.operation ?? '');
  const opaqueSideEffectOperations = new Set([
    'type_text', 'paste_text', 'press_key', 'hotkey', 'click', 'double_click',
    'right_click', 'drag', 'button_down', 'button_up', 'sequence',
  ]);
  return opaqueSideEffectOperations.has(operation)
    ? destructive('low-level input can trigger deletion, commands, or irreversible UI actions')
    : { destructive: false };
}

function destructive(reason: string): DestructivePolicyDecision {
  return { destructive: true, reason };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

function basename(value: string): string {
  return value.replaceAll('\\', '/').split('/').at(-1) ?? value;
}
