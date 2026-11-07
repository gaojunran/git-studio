import * as vscode from 'vscode';
import type { RefInfo } from '../../shared/protocol';
import { loadRefs } from '../git/refs';
import { resolveCommit } from '../git/revision';
import type { RepoHandle } from '../host/repoService';
import type { Services } from '../host/services';
import { inferBaseRef, loadMainlines, type BaseInference } from './baseBranch';

interface RefItem extends vscode.QuickPickItem {
  value?: string;
}

export interface PickRefOptions {
  placeHolder?: string;
  allowCustom?: boolean;
  includeHead?: boolean;
  excludeCurrent?: boolean;
  /** Show every ref instead of the capped recent list. */
  all?: boolean;
  /** When set, an inferred base branch is offered first and mainlines second. */
  inference?: { currentRef: string };
}

const LIMIT = {
  mainlines: 20,
  local: 40,
  remote: 40,
  tags: 20
};

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

interface PickerHandle {
  promise: Promise<RefItem | undefined>;
  update(items: RefItem[], busy: boolean): void;
}

function openPicker(items: RefItem[], placeholder: string): PickerHandle {
  const quickPick = vscode.window.createQuickPick<RefItem>();
  quickPick.placeholder = placeholder;
  quickPick.matchOnDescription = true;
  quickPick.items = items;
  quickPick.busy = true;

  let disposed = false;
  const promise = new Promise<RefItem | undefined>((resolve) => {
    let settled = false;
    const done = (value: RefItem | undefined) => {
      if (settled) {
        return;
      }
      settled = true;
      disposed = true;
      quickPick.dispose();
      resolve(value);
    };
    quickPick.onDidAccept(() => done(quickPick.selectedItems[0]));
    quickPick.onDidHide(() => done(undefined));
  });
  quickPick.show();

  return {
    promise,
    update(next, busy) {
      if (disposed) {
        return;
      }
      quickPick.busy = busy;
      quickPick.items = next;
    }
  };
}

export async function pickRef(
  services: Services,
  repo: RepoHandle,
  options: PickRefOptions = {}
): Promise<string | undefined> {
  const loading: RefItem[] = [
    { label: '$(sync~spin) Loading refs…', kind: vscode.QuickPickItemKind.Separator }
  ];
  let refs: RefInfo[] | undefined;
  let inference: BaseInference | undefined;
  let mainlines: RefInfo[] = [];
  let all = options.all ?? false;

  while (true) {
    const handle = openPicker(loading, options.placeHolder ?? 'Select a ref…');

    if (!refs) {
      try {
        refs = await loadRefs(services.runner, repo.root);
        if (options.inference) {
          [inference, mainlines] = await Promise.all([
            inferBaseRef(services, repo, refs, options.inference.currentRef),
            loadMainlines(services, repo, refs)
          ]);
        }
      } catch (error) {
        handle.update([{ label: '$(error) Failed to load refs', description: String(error) }], false);
        await handle.promise;
        return undefined;
      }
    }
    handle.update(buildItems(refs, inference, mainlines, options, all), false);

    const picked = await handle.promise;
    if (!picked?.value) {
      return undefined;
    }
    if (picked.value === '__all__') {
      all = true;
      continue;
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
}

function buildItems(
  refs: RefInfo[],
  inference: BaseInference | undefined,
  mainlines: RefInfo[],
  options: PickRefOptions,
  all: boolean
): RefItem[] {
  const byName = new Map(refs.map((ref) => [ref.name, ref]));
  const contained = inference?.contained ?? new Set<string>();
  const currentRef = options.inference?.currentRef;
  const items: RefItem[] = [];
  const used = new Set<string>();
  let capped = false;

  const exclude = (ref: RefInfo) =>
    used.has(ref.name) || (options.excludeCurrent === true && ref.name === currentRef);

  const isCurrent = (ref: RefInfo) => ref.current || ref.name === currentRef;

  const rank = (ref: RefInfo) => {
    const current = isCurrent(ref) ? 1 : 0;
    const isContained = contained.has(ref.name) ? 1 : 0;
    return [current, isContained, ref.committerDate] as const;
  };

  const sorted = (group: RefInfo[]) =>
    [...group].sort((a, b) => {
      const [ac, am, ad] = rank(a);
      const [bc, bm, bd] = rank(b);
      return bc - ac || bm - am || bd - ad || a.shortName.localeCompare(b.shortName);
    });

  const addGroup = (label: string, group: RefInfo[], description?: string) => {
    const visible = sorted(group).filter((ref) => !exclude(ref));
    if (visible.length === 0) {
      return;
    }
    const limit = all ? visible.length : Math.min(visible.length, groupLimit(label));
    if (limit < visible.length) {
      capped = true;
    }
    items.push({ label, kind: vscode.QuickPickItemKind.Separator });
    items.push(
      ...visible.slice(0, limit).map((ref) => {
        const base = description ?? refItem(ref).description;
        const detail = contained.has(ref.name) && !ref.current ? `${base} · contained` : base;
        return { ...refItem(ref), description: detail };
      })
    );
    visible.slice(0, limit).forEach((ref) => used.add(ref.name));
  };

  const customItem: RefItem = { label: '$(edit) Custom revision…', value: '__custom__' };
  const headItem: RefItem = {
    label: 'HEAD',
    description: options.inference ? 'uncommitted changes only' : 'current commit',
    value: 'HEAD'
  };

  if (inference) {
    const guess = inference.guess;
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

    addGroup('Mainlines', mainlines, 'mainline');

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

  addGroup('Local branches', refs.filter((ref) => ref.type === 'local' || ref.type === 'head'));
  addGroup('Remote branches', refs.filter((ref) => ref.type === 'remote'));
  addGroup('Tags', refs.filter((ref) => ref.type === 'tag'));

  if (capped) {
    items.push({ label: '$(list-unordered) Show all refs…', value: '__all__' });
  }
  if (inference && options.allowCustom !== false) {
    items.push(customItem);
  }

  return items;
}

function groupLimit(label: string): number {
  if (label === 'Mainlines') {
    return LIMIT.mainlines;
  }
  if (label === 'Local branches') {
    return LIMIT.local;
  }
  if (label === 'Remote branches') {
    return LIMIT.remote;
  }
  return LIMIT.tags;
}
