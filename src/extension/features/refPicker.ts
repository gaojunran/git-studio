import * as vscode from 'vscode';
import type { RefInfo } from '../../shared/protocol';
import { loadRefs } from '../git/refs';
import { resolveCommit } from '../git/revision';
import type { RepoHandle } from '../host/repoService';
import type { Services } from '../host/services';
import { inferBaseRef, isMainline, loadMainlines } from './baseBranch';

interface RefItem extends vscode.QuickPickItem {
  value?: string;
}

export interface PickRefOptions {
  placeHolder?: string;
  allowCustom?: boolean;
  includeHead?: boolean;
  excludeCurrent?: boolean;
  /** When set, an inferred base branch is offered first and mainlines second. */
  inference?: { currentRef: string };
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
  const byName = new Map(refs.map((ref) => [ref.name, ref]));
  const byRecency = (a: RefInfo, b: RefInfo) => b.committerDate - a.committerDate;
  const locals = refs.filter((ref) => ref.type === 'local' || ref.type === 'head').sort(byRecency);
  const remotes = refs.filter((ref) => ref.type === 'remote').sort(byRecency);
  const tags = refs.filter((ref) => ref.type === 'tag').sort(byRecency);

  const items: RefItem[] = [];
  const used = new Set<string>();
  const exclude = (ref: RefInfo) =>
    used.has(ref.name) || (options.excludeCurrent === true && ref.name === options.inference?.currentRef);

  const addGroup = (label: string, group: RefInfo[], description?: string) => {
    const visible = group.filter((ref) => !exclude(ref));
    if (visible.length === 0) {
      return;
    }
    items.push({ label, kind: vscode.QuickPickItemKind.Separator });
    items.push(...visible.map((ref) => ({ ...refItem(ref), ...(description ? { description } : {}) })));
    visible.forEach((ref) => used.add(ref.name));
  };

  const customItem: RefItem = { label: '$(edit) Custom revision…', value: '__custom__' };
  const headItem: RefItem = {
    label: 'HEAD',
    description: options.inference ? 'uncommitted changes only' : 'current commit',
    value: 'HEAD'
  };

  if (options.inference) {
    const guess = await inferBaseRef(services, repo, refs, options.inference.currentRef);
    if (guess) {
      const ref = byName.get(guess.ref);
      items.push({
        label: `$(lightbulb) ${guess.label}`,
        description: `inferred base · ${guess.reason}`,
        detail: ref?.oid.slice(0, 8),
        value: guess.ref
      });
      used.add(guess.ref);
    }

    const inferredIsMainline = guess ? (byName.has(guess.ref) && isMainline(byName.get(guess.ref)!)) : false;
    if (!inferredIsMainline) {
      const mainlines = await loadMainlines(services, repo, refs);
      addGroup('Mainlines', mainlines, 'mainline');
    }

    if (options.includeHead !== false) {
      items.push(headItem);
    }
  } else {
    if (options.includeHead !== false) {
      items.push(headItem);
    }
    if (options.allowCustom !== false) {
      items.push(customItem);
    }
  }

  addGroup('Local branches', locals);
  addGroup('Remote branches', remotes);
  addGroup('Tags', tags);

  if (options.inference && options.allowCustom !== false) {
    items.push(customItem);
  }

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
