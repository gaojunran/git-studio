import * as vscode from 'vscode';
import { headOid } from '../git/write';
import { resolveCommit } from '../git/revision';
import type { Services } from '../host/services';
import { HistoryPanel } from '../host/historyPanel';
import { pickRef, shortRef } from './refPicker';
import { openRefDiff, repoFor } from './diffs';

interface ReflogEntry {
  oid: string;
  selector: string;
  subject: string;
  createdAt: number;
}

async function loadReflog(services: Services, root: string, ref: string): Promise<ReflogEntry[]> {
  const output = await services.runner
    .run(['reflog', 'show', '--format=%H%x1f%gd%x1f%gs%x1f%ct', ref], root)
    .catch(() => '');
  return output
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [oid = '', selector = '', subject = '', created = ''] = line.split('\x1f');
      return { oid, selector, subject, createdAt: Number(created) * 1000 };
    })
    .filter((entry) => entry.oid);
}

function ago(timestamp: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

async function pickReflogRef(services: Services, root: string): Promise<string | undefined> {
  const branches = await services.runner
    .run(['for-each-ref', '--format=%(refname:short)', 'refs/heads'], root)
    .catch(() => '');
  const entries = ['HEAD', ...branches.split('\n').filter(Boolean)];
  if (entries.length === 1) {
    return 'HEAD';
  }
  const picked = await vscode.window.showQuickPick(entries, {
    placeHolder: 'Reflog of which ref?',
    title: 'Reflog'
  });
  return picked;
}

async function restoreOnBranch(services: Services, root: string, entry: ReflogEntry): Promise<void> {
  const name = await vscode.window.showInputBox({
    title: 'Restore on a new branch',
    prompt: `Create a branch at ${entry.oid.slice(0, 12)}`,
    value: `restore-${entry.oid.slice(0, 7)}`,
    ignoreFocusOut: true,
    validateInput: (value) => (value.trim() ? undefined : 'Enter a branch name')
  });
  if (!name) {
    return;
  }
  try {
    const expected = await headOid(services.runner, root);
    await services.writes.run(root, expected, () => services.runner.run(['switch', '-c', name.trim(), entry.oid], root));
    await refresh(services, root);
    void vscode.window.showInformationMessage(`Git Studio: restored ${entry.oid.slice(0, 12)} on ${name.trim()}.`);
  } catch (error) {
    void vscode.window.showErrorMessage(`Git Studio: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function resetTo(services: Services, root: string, entry: ReflogEntry): Promise<void> {
  const confirmed = await vscode.window.showWarningMessage(
    `Reset --hard to ${entry.oid.slice(0, 12)}?`,
    { modal: true, detail: `${entry.selector} · ${entry.subject}\n\nTracked working tree changes will be discarded.` },
    'Reset'
  );
  if (confirmed !== 'Reset') {
    return;
  }
  try {
    const expected = await headOid(services.runner, root);
    await services.writes.run(root, expected, () => services.runner.run(['reset', '--hard', entry.oid], root));
    await refresh(services, root);
  } catch (error) {
    void vscode.window.showErrorMessage(`Git Studio: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function refresh(services: Services, root: string): Promise<void> {
  const repo = services.repoService.list().find((entry) => entry.root === root);
  await repo?.repo.status().catch(() => undefined);
  await HistoryPanel.refreshCurrent();
}

export async function reflogWorkbench(services: Services, uri?: vscode.Uri, focusOid?: string): Promise<void> {
  const repo = await repoFor(services, uri);
  if (!repo) {
    return;
  }
  const ref = focusOid ? 'HEAD' : await pickReflogRef(services, repo.root);
  if (!ref) {
    return;
  }
  for (;;) {
    const entries = await loadReflog(services, repo.root, ref);
    const picked = await vscode.window.showQuickPick(
      entries.map((entry) => ({
        label: entry.selector,
        description: `${ago(entry.createdAt)} · ${entry.subject}`,
        detail: entry.oid.slice(0, 12),
        entry
      })),
      { placeHolder: `Reflog of ${ref}` }
    );
    if (!picked) {
      return;
    }
    const entry = picked.entry;
    const action = await vscode.window.showQuickPick(
      [
        { label: '$(history) Show commit', action: 'show' as const },
        { label: '$(diff) Compare with HEAD', action: 'compare-head' as const },
        { label: '$(git-compare) Compare with a ref…', action: 'compare-ref' as const },
        { label: '$(git-branch) Restore on a new branch…', action: 'branch' as const },
        { label: '$(warning) Reset --hard to here…', action: 'reset' as const }
      ],
      { placeHolder: `${entry.selector} · ${entry.subject}` }
    );
    if (!action) {
      continue;
    }
    if (action.action === 'show') {
      await HistoryPanel.show(services, { repo, focus: entry.oid });
      return;
    }
    if (action.action === 'compare-head') {
      await openRefDiff(services, repo, entry.oid, 'HEAD', `${entry.oid.slice(0, 12)} ↔ HEAD`);
      return;
    }
    if (action.action === 'compare-ref') {
      const other = await pickRef(services, repo, { placeHolder: `Compare ${entry.oid.slice(0, 12)} with…` });
      if (!other) {
        continue;
      }
      await openRefDiff(services, repo, entry.oid, other, `${shortRef(entry.oid)} ↔ ${shortRef(other)}`);
      return;
    }
    if (action.action === 'branch') {
      await restoreOnBranch(services, repo.root, entry);
      continue;
    }
    await resetTo(services, repo.root, entry);
  }
}

export async function compareReflogEntry(services: Services, uri?: vscode.Uri): Promise<void> {
  const repo = await repoFor(services, uri);
  if (!repo) {
    return;
  }
  const ref = await pickReflogRef(services, repo.root);
  if (!ref) {
    return;
  }
  const entries = await loadReflog(services, repo.root, ref);
  const picked = await vscode.window.showQuickPick(
    entries.map((entry) => ({
      label: entry.selector,
      description: `${ago(entry.createdAt)} · ${entry.subject}`,
      detail: entry.oid.slice(0, 12),
      entry
    })),
    { placeHolder: `Compare which ${ref} reflog entry with HEAD?` }
  );
  if (!picked) {
    return;
  }
  await openRefDiff(services, repo, picked.entry.oid, 'HEAD', `${picked.entry.oid.slice(0, 12)} ↔ HEAD`);
}

export async function reflogUndo(services: Services, uri?: vscode.Uri): Promise<void> {
  const repo = await repoFor(services, uri);
  if (!repo) {
    return;
  }
  const entries = await loadReflog(services, repo.root, 'HEAD');
  const current = await resolveCommit(services.runner, repo.root, 'HEAD').catch(() => undefined);
  const previous = entries.find((entry) => entry.oid !== current);
  if (!previous) {
    void vscode.window.showInformationMessage('Git Studio: no earlier HEAD entry in the reflog.');
    return;
  }
  const action = await vscode.window.showWarningMessage(
    `Restore HEAD to ${previous.selector}?`,
    { modal: true, detail: `${previous.subject}\n${previous.oid.slice(0, 12)}\n\nThis resets --hard and discards tracked working tree changes.` },
    'Restore',
    'Choose another entry…'
  );
  if (action === 'Choose another entry…') {
    await reflogWorkbench(services, uri);
    return;
  }
  if (action !== 'Restore') {
    return;
  }
  await resetTo(services, repo.root, previous);
}
