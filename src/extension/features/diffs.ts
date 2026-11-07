import * as path from 'node:path';
import * as vscode from 'vscode';
import type { FileChange } from '../../shared/protocol';
import { loadDiffFiles, loadWorktreeFiles } from '../git/diff';
import { resolveCommit } from '../git/revision';
import type { RepoHandle } from '../host/repoService';
import type { Services } from '../host/services';
import { emptyUri, gitUri } from '../host/uris';
import { pickRef, shortRef } from './refPicker';
import { currentBranchRef, resolveCurrentRef } from './currentRef';
import { mergeBaseLabel, mergeBaseOf } from './mergeBase';

export async function repoFor(services: Services, uri?: vscode.Uri): Promise<RepoHandle | undefined> {
  const repo = await services.repoService.pick(uri ?? vscode.window.activeTextEditor?.document.uri);
  if (!repo) {
    void vscode.window.showWarningMessage('Git Studio: no Git repository found in this workspace.');
  }
  return repo;
}

function refEntries(
  services: Services,
  repo: RepoHandle,
  left: string,
  right: string,
  files: FileChange[]
): [vscode.Uri, vscode.Uri, vscode.Uri][] {
  return files.map((file) => {
    const oldPath = file.oldPath ?? file.path;
    const leftUri = file.status === 'A' ? emptyUri(oldPath) : gitUri(services, repo, oldPath, left);
    const rightUri = file.status === 'D' ? emptyUri(file.path) : gitUri(services, repo, file.path, right);
    return [vscode.Uri.joinPath(repo.repo.rootUri, file.path), leftUri, rightUri];
  });
}

export async function openRefDiff(
  services: Services,
  repo: RepoHandle,
  left: string,
  right: string,
  title: string
): Promise<void> {
  const files = await loadDiffFiles(services.runner, repo.root, left, right);
  if (files.length === 0) {
    void vscode.window.showInformationMessage(`Git Studio: no changes between ${shortRef(left)} and ${shortRef(right)}.`);
    return;
  }
  await vscode.commands.executeCommand('vscode.changes', title, refEntries(services, repo, left, right, files));
}

export async function compareRefs(
  services: Services,
  uri?: vscode.Uri,
  leftOverride?: string,
  rightOverride?: string
): Promise<void> {
  const repo = await repoFor(services, uri);
  if (!repo) {
    return;
  }

  const left = leftOverride ?? await pickRef(services, repo, { placeHolder: 'Base ref…' });
  if (!left) {
    return;
  }
  const right = rightOverride ?? await pickRef(services, repo, { placeHolder: `Compare ${shortRef(left)} with…` });
  if (!right) {
    return;
  }
  if (left === right) {
    void vscode.window.showInformationMessage('Git Studio: pick two different refs.');
    return;
  }

  await openRefDiff(services, repo, left, right, `${shortRef(left)} ↔ ${shortRef(right)}`);
}

export async function compareRefsMergeBase(
  services: Services,
  uri?: vscode.Uri,
  leftOverride?: string,
  rightOverride?: string
): Promise<void> {
  const repo = await repoFor(services, uri);
  if (!repo) {
    return;
  }

  const left = leftOverride ?? await pickRef(services, repo, { placeHolder: 'Base ref…' });
  if (!left) {
    return;
  }
  const right = rightOverride ?? await pickRef(services, repo, { placeHolder: `Compare ${shortRef(left)} with…` });
  if (!right) {
    return;
  }
  if (left === right) {
    void vscode.window.showInformationMessage('Git Studio: pick two different refs.');
    return;
  }

  const base = await mergeBaseOf(services, repo, left, right);
  if (!base) {
    void vscode.window.showInformationMessage(
      `Git Studio: ${shortRef(left)} and ${shortRef(right)} have no common ancestor.`
    );
    return;
  }

  await openRefDiff(
    services,
    repo,
    base,
    right,
    `Changes on ${shortRef(right)} since merge-base(${shortRef(left)})`
  );
}

export async function compareMergeBase(
  services: Services,
  uri?: vscode.Uri,
  refOverride?: string,
  currentOverride?: string
): Promise<void> {
  const repo = await repoFor(services, uri);
  if (!repo) {
    return;
  }

  const current = currentOverride
    ? { ref: currentOverride, label: shortRef(currentOverride), detached: currentOverride === 'HEAD' }
    : await resolveCurrentRef(services, repo);
  if (!current) {
    return;
  }

  const ref = refOverride ?? await pickRef(services, repo, {
    placeHolder: `Compare ${current.label} against…`,
    includeHead: false,
    excludeCurrent: true,
    inference: { currentRef: current.ref }
  });
  if (!ref) {
    return;
  }
  if (ref === current.ref) {
    void vscode.window.showInformationMessage('Git Studio: pick a different ref to compare against.');
    return;
  }

  const base = await mergeBaseOf(services, repo, current.ref, ref);
  if (!base) {
    void vscode.window.showInformationMessage(
      `Git Studio: ${current.label} has no common ancestor with ${shortRef(ref)}.`
    );
    return;
  }

  await openRefDiff(
    services,
    repo,
    base,
    current.ref,
    `Changes on ${current.label} since merge-base(${shortRef(ref)})`
  );
}

export async function compareStash(services: Services, uri?: vscode.Uri, stashOverride?: string): Promise<void> {
  const repo = await repoFor(services, uri);
  if (!repo) {
    return;
  }

  const output = await services.runner
    .run(['stash', 'list', '--format=%gd%x1f%s%x00'], repo.root)
    .catch(() => '');
  const stashes = output
    .split('\x00')
    .filter(Boolean)
    .map((record) => {
      const [ref = '', subject = ''] = record.replace(/^\n/, '').split('\x1f');
      return { ref, subject };
    })
    .filter((stash) => stash.ref);

  if (stashes.length === 0) {
    void vscode.window.showInformationMessage('Git Studio: this repository has no stashes.');
    return;
  }

  const picked = stashOverride
    ? stashes.find((stash) => stash.ref === stashOverride) ?? { ref: stashOverride, subject: '' }
    : (await vscode.window.showQuickPick(
      stashes.map((stash) => ({ label: stash.ref, description: stash.subject, stash })),
      { placeHolder: 'Compare stash with its parent commit' }
    ))?.stash;
  if (!picked) {
    return;
  }

  const parent = await resolveCommit(services.runner, repo.root, `${picked.ref}^1`).catch(() => undefined);
  if (!parent) {
    void vscode.window.showErrorMessage(`Git Studio: cannot resolve the parent of ${picked.ref}.`);
    return;
  }
  const stashOid = await resolveCommit(services.runner, repo.root, picked.ref).catch(() => undefined);
  if (!stashOid) {
    return;
  }

  await openRefDiff(services, repo, parent, stashOid, `${picked.ref} · ${picked.subject}`);
}

async function existsAt(services: Services, repo: RepoHandle, ref: string, filePath: string): Promise<boolean> {
  return services.runner
    .run(['cat-file', '-e', `${ref}:${filePath}`], repo.root)
    .then(() => true)
    .catch(() => false);
}

export async function compareFileRevisions(
  services: Services,
  uri?: vscode.Uri,
  leftOverride?: string,
  rightOverride?: string
): Promise<void> {
  const fileUri = uri ?? vscode.window.activeTextEditor?.document.uri;
  if (!fileUri || fileUri.scheme !== 'file') {
    void vscode.window.showWarningMessage('Git Studio: open a file to compare its revisions.');
    return;
  }

  const repo = await repoFor(services, fileUri);
  if (!repo) {
    return;
  }
  const relative = services.repoService.relativePath(repo, fileUri);
  if (!relative) {
    void vscode.window.showWarningMessage('Git Studio: the file is outside the repository.');
    return;
  }

  const left = leftOverride ?? await pickRef(services, repo, { placeHolder: 'Base revision…' });
  if (!left) {
    return;
  }
  const right = rightOverride ?? await pickRef(services, repo, { placeHolder: `Compare ${shortRef(left)} with…` });
  if (!right) {
    return;
  }
  if (left === right) {
    void vscode.window.showInformationMessage('Git Studio: pick two different revisions.');
    return;
  }

  const [leftExists, rightExists] = await Promise.all([
    existsAt(services, repo, left, relative),
    existsAt(services, repo, right, relative)
  ]);
  if (!leftExists && !rightExists) {
    void vscode.window.showInformationMessage(`Git Studio: ${relative} does not exist in either revision.`);
    return;
  }

  const leftUri = leftExists ? gitUri(services, repo, relative, left) : emptyUri(relative);
  const rightUri = rightExists ? gitUri(services, repo, relative, right) : emptyUri(relative);
  await vscode.commands.executeCommand(
    'vscode.diff',
    leftUri,
    rightUri,
    `${path.basename(relative)} (${shortRef(left)} ↔ ${shortRef(right)})`,
    { preview: true }
  );
}

export async function compareFolder(services: Services, uri?: vscode.Uri, refOverride?: string): Promise<void> {
  const folderUri = uri ?? vscode.window.activeTextEditor?.document.uri;
  if (!folderUri || folderUri.scheme !== 'file') {
    void vscode.window.showWarningMessage('Git Studio: select a folder to compare.');
    return;
  }

  const repo = await repoFor(services, folderUri);
  if (!repo) {
    return;
  }

  let stat: vscode.FileStat | undefined;
  try {
    stat = await vscode.workspace.fs.stat(folderUri);
  } catch {
    stat = undefined;
  }
  const relative = services.repoService.relativePath(repo, folderUri);
  if (!relative) {
    void vscode.window.showWarningMessage('Git Studio: select a folder inside the repository.');
    return;
  }
  const prefix = stat?.type === vscode.FileType.Directory
    ? relative
    : path.posix.dirname(relative);

  const ref = refOverride ?? await pickRef(services, repo, {
    placeHolder: 'Compare folder with working tree…',
    includeHead: true,
    inference: { currentRef: (await currentBranchRef(services, repo)) ?? 'HEAD' }
  });
  if (!ref) {
    return;
  }
  const base = await mergeBaseOf(services, repo, ref, 'HEAD');
  if (!base) {
    void vscode.window.showInformationMessage(`Git Studio: ${shortRef(ref)} has no common ancestor with HEAD.`);
    return;
  }
  const scope = mergeBaseLabel(shortRef(ref));

  const all = await loadWorktreeFiles(services.runner, repo.root, base);
  const files = all.filter((file) => file.path.startsWith(`${prefix}/`) || file.oldPath?.startsWith(`${prefix}/`));
  if (files.length === 0) {
    void vscode.window.showInformationMessage(`Git Studio: no changes under ${prefix} compared to ${scope}.`);
    return;
  }

  const entries: [vscode.Uri, vscode.Uri, vscode.Uri][] = files.map((file) => {
    const worktree = vscode.Uri.joinPath(repo.repo.rootUri, file.path);
    const oldPath = file.oldPath ?? file.path;
    const left = file.status === 'A' ? emptyUri(oldPath) : gitUri(services, repo, oldPath, base);
    const right = file.status === 'D' ? emptyUri(file.path) : worktree;
    return [worktree, left, right];
  });

  await vscode.commands.executeCommand('vscode.changes', `${prefix} ↔ ${scope}`, entries);
}

export async function compareIncoming(services: Services, uri?: vscode.Uri): Promise<void> {
  const repo = await repoFor(services, uri);
  if (!repo) {
    return;
  }
  const upstream = await services.runner
    .run(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'], repo.root)
    .then((value) => value.trim())
    .catch(() => '');
  if (!upstream) {
    void vscode.window.showInformationMessage('Git Studio: the current branch has no upstream.');
    return;
  }
  await openRefDiff(services, repo, 'HEAD', upstream, `Incoming ↔ ${shortRef(upstream)}`);
}

export async function compareTagPrevious(services: Services, uri?: vscode.Uri): Promise<void> {
  const repo = await repoFor(services, uri);
  if (!repo) {
    return;
  }
  const output = await services.runner
    .run(['for-each-ref', '--sort=-creatordate', '--format=%(refname:short)', 'refs/tags'], repo.root)
    .catch(() => '');
  const tags = output.split('\n').filter(Boolean);
  if (tags.length < 2) {
    void vscode.window.showInformationMessage('Git Studio: this repository has fewer than two tags.');
    return;
  }
  const picked = await vscode.window.showQuickPick(tags, { placeHolder: 'Compare which tag with its previous tag?' });
  if (!picked) {
    return;
  }
  const index = tags.indexOf(picked);
  const previous = tags[index + 1];
  if (!previous) {
    void vscode.window.showInformationMessage(`Git Studio: ${picked} is the oldest tag.`);
    return;
  }
  await openRefDiff(services, repo, previous, picked, `${shortRef(previous)} ↔ ${shortRef(picked)}`);
}

export async function compareRemoteTracking(services: Services, uri?: vscode.Uri): Promise<void> {
  const repo = await repoFor(services, uri);
  if (!repo) {
    return;
  }
  const output = await services.runner
    .run(['for-each-ref', '--sort=-committerdate', '--format=%(refname:short)', 'refs/remotes'], repo.root)
    .catch(() => '');
  const remotes = output.split('\n').filter((name) => name && !name.endsWith('/HEAD'));
  if (remotes.length === 0) {
    void vscode.window.showInformationMessage('Git Studio: this repository has no remote-tracking branches.');
    return;
  }
  const picked = await vscode.window.showQuickPick(remotes, { placeHolder: 'Compare with which remote-tracking branch?' });
  if (!picked) {
    return;
  }
  const direction = await vscode.window.showQuickPick(
    [
      { label: `${picked} → HEAD`, value: 'incoming' as const },
      { label: `HEAD → ${picked}`, value: 'outgoing' as const }
    ],
    { placeHolder: 'Which direction?' }
  );
  if (!direction) {
    return;
  }
  await openRefDiff(
    services,
    repo,
    direction.value === 'incoming' ? picked : 'HEAD',
    direction.value === 'incoming' ? 'HEAD' : picked,
    direction.value === 'incoming' ? `Incoming ↔ ${shortRef(picked)}` : `Outgoing ↔ ${shortRef(picked)}`
  );
}

export async function compareUnpushed(services: Services, uri?: vscode.Uri): Promise<void> {
  const repo = await repoFor(services, uri);
  if (!repo) {
    return;
  }

  const upstream = await services.runner
    .run(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'], repo.root)
    .then((output) => output.trim())
    .catch(() => '');
  if (!upstream) {
    void vscode.window.showInformationMessage('Git Studio: the current branch has no upstream.');
    return;
  }

  await openRefDiff(services, repo, upstream, 'HEAD', `Unpushed ↔ ${upstream}`);
}
