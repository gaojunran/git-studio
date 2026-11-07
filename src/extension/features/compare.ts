import * as path from 'node:path';
import * as vscode from 'vscode';
import { loadWorktreeFiles } from '../git/diff';
import type { Services } from '../host/services';
import { emptyUri, gitUri } from '../host/uris';
import { pickRef, shortRef } from './refPicker';
import { currentBranchRef } from './currentRef';
import { mergeBaseLabel, mergeBaseOf } from './mergeBase';

export async function compareWorkingTree(services: Services, uri?: vscode.Uri, refOverride?: string): Promise<void> {
  const repo = await services.repoService.pick(uri ?? vscode.window.activeTextEditor?.document.uri);
  if (!repo) {
    void vscode.window.showWarningMessage('Git Studio: no Git repository found in this workspace.');
    return;
  }

  const ref = refOverride ?? await pickRef(services, repo, {
    placeHolder: 'Compare working tree with…',
    includeHead: true,
    inference: { currentRef: (await currentBranchRef(services, repo)) ?? 'HEAD' }
  });
  if (!ref) {
    return;
  }
  const label = shortRef(ref);
  const base = await mergeBaseOf(services, repo, ref, 'HEAD');
  if (!base) {
    void vscode.window.showInformationMessage(`Git Studio: ${label} has no common ancestor with HEAD.`);
    return;
  }
  const scope = mergeBaseLabel(label);

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

  const files = await loadWorktreeFiles(services.runner, repo.root, base);
  if (files.length === 0) {
    void vscode.window.showInformationMessage(`Git Studio: working tree matches ${scope}.`);
    return;
  }

  const toEntry = (file: (typeof files)[number]): [vscode.Uri, vscode.Uri, vscode.Uri] => {
    const worktree = vscode.Uri.joinPath(repo.repo.rootUri, file.path);
    const oldPath = file.oldPath ?? file.path;
    const left = file.status === 'A' ? emptyUri(oldPath) : gitUri(services, repo, oldPath, base);
    const right = file.status === 'D' ? emptyUri(file.path) : worktree;
    return [worktree, left, right];
  };

  if (relative) {
    const change = files.find((file) => file.path === relative || file.oldPath === relative);
    if (!change) {
      void vscode.window.showInformationMessage(`Git Studio: ${relative} matches ${scope}.`);
      return;
    }
    const [, left, right] = toEntry(change);
    await vscode.commands.executeCommand(
      'vscode.diff',
      left,
      right,
      `${path.basename(change.path)} (Working Tree ↔ ${scope})`,
      { preview: true }
    );
    return;
  }

  await vscode.commands.executeCommand(
    'vscode.changes',
    `Working Tree ↔ ${scope}`,
    files.map(toEntry)
  );
}
