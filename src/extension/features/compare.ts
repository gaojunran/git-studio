import * as path from 'node:path';
import * as vscode from 'vscode';
import type { RefInfo } from '../../shared/protocol';
import { loadWorktreeFiles } from '../git/diff';
import { loadRefs } from '../git/refs';
import { resolveCommit } from '../git/revision';
import type { RepoHandle } from '../host/repoService';
import type { Services } from '../host/services';
import { emptyUri, gitUri } from '../host/uris';

interface RefItem extends vscode.QuickPickItem {
  value?: string;
}

function refItem(ref: RefInfo): RefItem {
  return {
    label: ref.shortName,
    description: ref.current ? 'current' : ref.type === 'tag' ? 'tag' : ref.type === 'remote' ? 'remote' : 'branch',
    detail: ref.oid.slice(0, 8),
    value: ref.name
  };
}

async function pickRef(services: Services, repo: RepoHandle): Promise<string | undefined> {
  const refs = await loadRefs(services.runner, repo.root);
  const byRecency = (a: RefInfo, b: RefInfo) => b.committerDate - a.committerDate;
  const locals = refs.filter((ref) => ref.type === 'local').sort(byRecency);
  const remotes = refs.filter((ref) => ref.type === 'remote').sort(byRecency);
  const tags = refs.filter((ref) => ref.type === 'tag').sort(byRecency);

  const items: RefItem[] = [
    { label: 'HEAD', description: 'current commit', value: 'HEAD' },
    { label: '$(edit) Custom revision…', value: '__custom__' }
  ];

  const addGroup = (label: string, group: RefInfo[]) => {
    if (group.length === 0) {
      return;
    }
    items.push({ label, kind: vscode.QuickPickItemKind.Separator });
    items.push(...group.map(refItem));
  };

  addGroup('Local branches', locals);
  addGroup('Remote branches', remotes);
  addGroup('Tags', tags);

  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: 'Compare working tree with…',
    matchOnDescription: true
  });
  if (!picked?.value) {
    return undefined;
  }
  if (picked.value !== '__custom__') {
    return picked.value;
  }

  const input = await vscode.window.showInputBox({
    prompt: 'Commit, branch or tag to compare against',
    placeHolder: 'e.g. origin/main or a1b2c3d'
  });
  const revision = input?.trim();
  if (!revision) {
    return undefined;
  }

  try {
    await resolveCommit(services.runner, repo.root, revision);
    return revision;
  } catch {
    void vscode.window.showErrorMessage(`Git Studio: unknown revision "${revision}".`);
    return undefined;
  }
}

function labelFor(ref: string): string {
  return ref.startsWith('refs/')
    ? ref.replace(/^refs\/(heads|remotes|tags)\//, '')
    : ref;
}

export async function compareWorkingTree(services: Services, uri?: vscode.Uri, refOverride?: string): Promise<void> {
  const repo = await services.repoService.pick(uri ?? vscode.window.activeTextEditor?.document.uri);
  if (!repo) {
    void vscode.window.showWarningMessage('Git Studio: no Git repository found in this workspace.');
    return;
  }

  const ref = refOverride ?? await pickRef(services, repo);
  if (!ref) {
    return;
  }
  const label = labelFor(ref);

  let relative: string | undefined;
  if (uri?.scheme === 'file') {
    try {
      const stat = await vscode.workspace.fs.stat(uri);
      if (stat.type === vscode.FileType.File) {
        relative = services.repoService.relativePath(repo, uri);
      }
    } catch {
      relative = undefined;
    }
  }

  const files = await loadWorktreeFiles(services.runner, repo.root, ref);
  if (files.length === 0) {
    void vscode.window.showInformationMessage(`Git Studio: working tree matches ${label}.`);
    return;
  }

  const toEntry = (file: (typeof files)[number]): [vscode.Uri, vscode.Uri, vscode.Uri] => {
    const worktree = vscode.Uri.joinPath(repo.repo.rootUri, file.path);
    const oldPath = file.oldPath ?? file.path;
    const left = file.status === 'A' ? emptyUri(oldPath) : gitUri(services, repo, oldPath, ref);
    const right = file.status === 'D' ? emptyUri(file.path) : worktree;
    return [worktree, left, right];
  };

  if (relative) {
    const change = files.find((file) => file.path === relative || file.oldPath === relative);
    if (!change) {
      void vscode.window.showInformationMessage(`Git Studio: ${relative} matches ${label}.`);
      return;
    }
    const [, left, right] = toEntry(change);
    await vscode.commands.executeCommand(
      'vscode.diff',
      left,
      right,
      `${path.basename(change.path)} (${label})`,
      { preview: true }
    );
    return;
  }

  await vscode.commands.executeCommand(
    'vscode.changes',
    `Working Tree ↔ ${label}`,
    files.map(toEntry)
  );
}
