import * as vscode from 'vscode';
import * as path from 'node:path';
import { headOid } from '../git/write';
import type { RepoHandle } from '../host/repoService';
import type { Services } from '../host/services';
import { pickRef } from './refPicker';
import { repoFor } from './diffs';

interface WorktreeEntry {
  path: string;
  head: string;
  branch: string | null;
  bare: boolean;
  dirty: boolean;
}

async function loadWorktrees(services: Services, root: string): Promise<WorktreeEntry[]> {
  const output = await services.runner.run(['worktree', 'list', '--porcelain'], root);
  const entries: WorktreeEntry[] = [];
  let current: Partial<WorktreeEntry> | undefined;
  const flush = () => {
    if (current?.path) {
      entries.push({
        path: current.path,
        head: current.head ?? '',
        branch: current.branch ?? null,
        bare: current.bare ?? false,
        dirty: false
      });
    }
    current = undefined;
  };
  for (const line of output.split('\n')) {
    if (!line) {
      flush();
      continue;
    }
    const [key, ...rest] = line.split(' ');
    const value = rest.join(' ');
    if (key === 'worktree') {
      flush();
      current = { path: value };
    } else if (key === 'HEAD') {
      current = { ...current, head: value };
    } else if (key === 'branch') {
      current = { ...current, branch: value.replace(/^refs\/heads\//, '') };
    } else if (key === 'bare') {
      current = { ...current, bare: true };
    }
  }
  flush();
  await Promise.all(
    entries.map(async (entry) => {
      entry.dirty = await services.runner
        .run(['-C', entry.path, 'status', '--porcelain'], root)
        .then((status) => status.trim().length > 0)
        .catch(() => false);
    })
  );
  return entries;
}

async function openWorktree(entry: WorktreeEntry, newWindow: boolean): Promise<void> {
  await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(entry.path), { forceNewWindow: newWindow });
}

async function createWorktree(services: Services, repo: RepoHandle): Promise<void> {
  const root = repo.root;
  const ref = await pickRef(services, repo, { placeHolder: 'Create a worktree at which commit or branch?' });
  if (!ref) {
    return;
  }
  const suggested = path.join(path.dirname(root), `${path.basename(root)}-${ref.replace(/[\\/]/g, '-')}`);
  const target = await vscode.window.showInputBox({
    title: 'Create worktree',
    prompt: 'Folder for the new worktree',
    value: suggested,
    ignoreFocusOut: true,
    validateInput: (value) => (value.trim() ? undefined : 'Enter a folder path')
  });
  if (!target) {
    return;
  }
  try {
    const expected = await headOid(services.runner, root);
    await services.writes.run(root, expected, () => services.runner.run(['worktree', 'add', target.trim(), ref], root));
    void vscode.window.showInformationMessage(`Git Studio: created worktree at ${target.trim()}.`);
  } catch (error) {
    void vscode.window.showErrorMessage(`Git Studio: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function removeWorktree(services: Services, root: string, entry: WorktreeEntry): Promise<void> {
  if (entry.dirty) {
    const confirmed = await vscode.window.showWarningMessage(
      `Remove worktree ${entry.path}?`,
      { modal: true, detail: 'It has uncommitted changes. They will be discarded.' },
      'Remove anyway'
    );
    if (confirmed !== 'Remove anyway') {
      return;
    }
  } else {
    const confirmed = await vscode.window.showWarningMessage(`Remove worktree ${entry.path}?`, { modal: true }, 'Remove');
    if (confirmed !== 'Remove') {
      return;
    }
  }
  try {
    const expected = await headOid(services.runner, root);
    await services.writes.run(root, expected, () =>
      services.runner.run(['worktree', 'remove', ...(entry.dirty ? ['--force'] : []), entry.path], root)
    );
  } catch (error) {
    void vscode.window.showErrorMessage(`Git Studio: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function worktreeWorkbench(services: Services, uri?: vscode.Uri): Promise<void> {
  const repo = await repoFor(services, uri);
  if (!repo) {
    return;
  }
  for (;;) {
    const worktrees = await loadWorktrees(services, repo.root);
    const picked = await vscode.window.showQuickPick(
      [
        { label: '$(add) Create worktree…', action: 'create' as const },
        { label: '$(trash) Prune stale worktrees', action: 'prune' as const },
        { label: '', kind: vscode.QuickPickItemKind.Separator, action: 'none' as const },
        ...worktrees.map((entry) => ({
          label: entry.path === repo.root ? `${entry.path} (main)` : entry.path,
          description: `${entry.branch ?? 'detached'}${entry.dirty ? ' · dirty' : ''}`,
          detail: entry.head.slice(0, 12),
          action: 'worktree' as const,
          entry
        }))
      ],
      { placeHolder: 'Worktrees' }
    );
    if (!picked) {
      return;
    }
    if (picked.action === 'create') {
      await createWorktree(services, repo);
      continue;
    }
    if (picked.action === 'prune') {
      await services.runner.run(['worktree', 'prune'], repo.root).catch(() => undefined);
      continue;
    }
    if (picked.action !== 'worktree') {
      return;
    }
    const entry = picked.entry!;
    const action = await vscode.window.showQuickPick(
      [
        { label: '$(window) Open in current window', action: 'open' as const },
        { label: '$(empty-window) Open in new window', action: 'open-new' as const },
        ...(entry.path === repo.root ? [] : [{ label: '$(trash) Remove…', action: 'remove' as const }])
      ],
      { placeHolder: entry.path }
    );
    if (!action) {
      continue;
    }
    if (action.action === 'open' || action.action === 'open-new') {
      await openWorktree(entry, action.action === 'open-new');
      return;
    }
    await removeWorktree(services, repo.root, entry);
  }
}
