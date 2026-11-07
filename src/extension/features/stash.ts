import * as vscode from 'vscode';
import { isConflict, headOid } from '../git/write';
import { resolveCommit } from '../git/revision';
import type { Services } from '../host/services';
import { repoFor, openRefDiff } from './diffs';

interface StashEntry {
  ref: string;
  subject: string;
  createdAt: number;
  oid: string;
}

async function loadStashes(services: Services, root: string): Promise<StashEntry[]> {
  const output = await services.runner.run(['stash', 'list', '--format=%gd%x1f%gs%x1f%ct%x1f%H'], root).catch(() => '');
  return output
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [ref = '', subject = '', created = '', oid = ''] = line.split('\x1f');
      return { ref, subject, createdAt: Number(created) * 1000, oid };
    })
    .filter((entry) => entry.ref);
}

function ago(timestamp: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

async function createStash(services: Services, root: string): Promise<void> {
  const message = await vscode.window.showInputBox({
    title: 'Create stash',
    prompt: 'A message for the stash',
    value: `WIP on ${new Date().toLocaleString()}`,
    ignoreFocusOut: true
  });
  if (message === undefined) {
    return;
  }
  const mode = await vscode.window.showQuickPick(
    [
      { label: 'All changes', description: 'Tracked changes, including staged', args: [] as string[] },
      { label: 'Include untracked files', description: 'Tracked and untracked, not ignored', args: ['--include-untracked'] },
      { label: 'Staged only', description: 'Leave unstaged changes in the working tree', args: ['--staged'] }
    ],
    { placeHolder: 'What should the stash contain?' }
  );
  if (!mode) {
    return;
  }
  try {
    await services.runner.run(['stash', 'push', '-m', message, ...mode.args], root);
    await refresh(services, root);
  } catch (error) {
    void vscode.window.showErrorMessage(`Git Studio: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function refresh(services: Services, root: string): Promise<void> {
  const repo = services.repoService.list().find((entry) => entry.root === root);
  await repo?.repo.status().catch(() => undefined);
  await vscode.commands.executeCommand('gitStudio.refresh');
}

async function applyStash(services: Services, root: string, stash: StashEntry, pop: boolean): Promise<void> {
  const verb = pop ? 'Pop' : 'Apply';
  const confirmed = await vscode.window.showWarningMessage(
    `${verb} ${stash.ref}?`,
    { modal: true, detail: stash.subject },
    verb
  );
  if (confirmed !== verb) {
    return;
  }
  try {
    const expected = await headOid(services.runner, root);
    await services.writes.run(root, expected, () => services.runner.run(['stash', pop ? 'pop' : 'apply', stash.ref], root));
    await refresh(services, root);
  } catch (error) {
    if (isConflict(error)) {
      const open = await vscode.window.showWarningMessage(
        `Git Studio: ${stash.ref} applied with conflicts. Resolve them in Source Control.`,
        'Show Source Control'
      );
      if (open) {
        await vscode.commands.executeCommand('workbench.view.scm');
      }
      return;
    }
    void vscode.window.showErrorMessage(`Git Studio: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function dropStash(services: Services, root: string, stash: StashEntry): Promise<void> {
  const confirmed = await vscode.window.showWarningMessage(
    `Drop ${stash.ref}?`,
    { modal: true, detail: `${stash.subject}\n\nThis cannot be undone from the UI.` },
    'Drop'
  );
  if (confirmed !== 'Drop') {
    return;
  }
  try {
    await services.runner.run(['stash', 'drop', stash.ref], root);
    await refresh(services, root);
  } catch (error) {
    void vscode.window.showErrorMessage(`Git Studio: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function openStash(services: Services, root: string, stash: StashEntry): Promise<void> {
  const parent = await resolveCommit(services.runner, root, `${stash.ref}^1`).catch(() => undefined);
  if (!parent) {
    void vscode.window.showErrorMessage(`Git Studio: cannot resolve the parent of ${stash.ref}.`);
    return;
  }
  const repo = services.repoService.list().find((entry) => entry.root === root);
  if (!repo) {
    return;
  }
  await openRefDiff(services, repo, parent, stash.oid, `${stash.ref} · ${stash.subject}`);
}

export async function stashWorkbench(services: Services, uri?: vscode.Uri): Promise<void> {
  const repo = await repoFor(services, uri);
  if (!repo) {
    return;
  }
  for (;;) {
    const stashes = await loadStashes(services, repo.root);
    const picked = await vscode.window.showQuickPick(
      [
        { label: '$(add) Create stash…', action: 'create' as const },
        { label: '', kind: vscode.QuickPickItemKind.Separator, action: 'none' as const },
        ...stashes.map((stash) => ({
          label: stash.ref,
          description: `${ago(stash.createdAt)} · ${stash.subject}`,
          detail: stash.oid.slice(0, 12),
          action: 'stash' as const,
          stash
        })),
        ...(stashes.length === 0
          ? [{ label: 'No stashes in this repository', action: 'none' as const }]
          : [])
      ],
      { placeHolder: 'Stashes — pick one to inspect or act on' }
    );
    if (!picked) {
      return;
    }
    if (picked.action === 'create') {
      await createStash(services, repo.root);
      continue;
    }
    if (picked.action !== 'stash') {
      return;
    }
    const stash = picked.stash!;
    const action = await vscode.window.showQuickPick(
      [
        { label: '$(diff) Open changes', action: 'open' as const },
        { label: '$(check) Apply', action: 'apply' as const },
        { label: '$(trash) Pop', action: 'pop' as const },
        { label: '$(close) Drop…', action: 'drop' as const }
      ],
      { placeHolder: `${stash.ref} · ${stash.subject}` }
    );
    if (!action) {
      continue;
    }
    if (action.action === 'open') {
      await openStash(services, repo.root, stash);
      return;
    }
    if (action.action === 'apply' || action.action === 'pop') {
      await applyStash(services, repo.root, stash, action.action === 'pop');
      continue;
    }
    await dropStash(services, repo.root, stash);
  }
}
