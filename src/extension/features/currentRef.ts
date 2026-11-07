import * as vscode from 'vscode';
import type { RepoHandle } from '../host/repoService';
import type { Services } from '../host/services';
import { shortRef } from './refPicker';

export interface CurrentRef {
  ref: string;
  label: string;
  detached: boolean;
}

async function containingBranches(services: Services, repo: RepoHandle): Promise<string[]> {
  return (await services.runner
    .run(['branch', '--contains', 'HEAD', '--format=%(refname:short)'], repo.root)
    .catch(() => ''))
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('('));
}

async function attachedBranch(services: Services, repo: RepoHandle): Promise<string | undefined> {
  const name = (await services.runner
    .run(['symbolic-ref', '--short', '-q', 'HEAD'], repo.root)
    .catch(() => ''))
    .trim();
  return name || undefined;
}

/** Non-interactive: attached branch, or the only branch containing a detached HEAD. */
export async function currentBranchRef(services: Services, repo: RepoHandle): Promise<string | undefined> {
  const attached = await attachedBranch(services, repo);
  if (attached) {
    return `refs/heads/${attached}`;
  }
  const branches = await containingBranches(services, repo);
  return branches.length === 1 ? `refs/heads/${branches[0]}` : undefined;
}

export async function resolveCurrentRef(services: Services, repo: RepoHandle): Promise<CurrentRef | undefined> {
  const attached = await attachedBranch(services, repo);
  if (attached) {
    return { ref: `refs/heads/${attached}`, label: attached, detached: false };
  }

  const shortHead =
    (await services.runner.run(['rev-parse', '--short', 'HEAD'], repo.root).catch(() => '')).trim() || 'HEAD';
  const branches = await containingBranches(services, repo);

  if (branches.length === 1) {
    return { ref: `refs/heads/${branches[0]}`, label: `${branches[0]} (detached)`, detached: true };
  }

  if (branches.length === 0) {
    return { ref: 'HEAD', label: `HEAD (${shortHead})`, detached: true };
  }

  const picked = await vscode.window.showQuickPick(
    [
      { label: `Detached HEAD (${shortHead})`, description: 'compare the commit itself', value: 'HEAD' },
      ...branches.map((branch) => ({
        label: branch,
        description: 'branch containing HEAD',
        value: `refs/heads/${branch}`
      }))
    ],
    { placeHolder: 'Detached HEAD — which branch represents the current state?' }
  );
  if (!picked) {
    return undefined;
  }
  return picked.value === 'HEAD'
    ? { ref: 'HEAD', label: `HEAD (${shortHead})`, detached: true }
    : { ref: picked.value, label: `${shortRef(picked.value)} (detached)`, detached: true };
}
