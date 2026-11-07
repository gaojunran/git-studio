import * as vscode from 'vscode';
import type { RefInfo } from '../../shared/protocol';
import { loadRefs } from '../git/refs';
import { resolveCommit } from '../git/revision';
import type { RepoHandle } from '../host/repoService';
import type { Services } from '../host/services';

interface RefItem extends vscode.QuickPickItem {
  value?: string;
}

export interface PickRefOptions {
  placeHolder?: string;
  allowCustom?: boolean;
}

function refItem(ref: RefInfo): RefItem {
  return {
    label: ref.shortName,
    description: ref.current ? 'current' : ref.type === 'tag' ? 'tag' : ref.type === 'remote' ? 'remote' : 'branch',
    detail: ref.oid.slice(0, 8),
    value: ref.name
  };
}

export function shortRef(ref: string): string {
  return ref.startsWith('refs/') ? ref.replace(/^refs\/(heads|remotes|tags)\//, '') : ref;
}

export async function pickRef(
  services: Services,
  repo: RepoHandle,
  options: PickRefOptions = {}
): Promise<string | undefined> {
  const refs = await loadRefs(services.runner, repo.root);
  const byRecency = (a: RefInfo, b: RefInfo) => b.committerDate - a.committerDate;
  const locals = refs.filter((ref) => ref.type === 'local').sort(byRecency);
  const remotes = refs.filter((ref) => ref.type === 'remote').sort(byRecency);
  const tags = refs.filter((ref) => ref.type === 'tag').sort(byRecency);

  const items: RefItem[] = [{ label: 'HEAD', description: 'current commit', value: 'HEAD' }];
  if (options.allowCustom !== false) {
    items.push({ label: '$(edit) Custom revision…', value: '__custom__' });
  }

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
    placeHolder: options.placeHolder ?? 'Select a ref…',
    matchOnDescription: true
  });
  if (!picked?.value) {
    return undefined;
  }
  if (picked.value !== '__custom__') {
    return picked.value;
  }

  const input = await vscode.window.showInputBox({
    prompt: 'Commit, branch or tag',
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
