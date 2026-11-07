import type { RefInfo } from '../../shared/protocol';

export type DefaultRefMode = 'primary' | 'current' | 'all';

export interface DefaultRefOptions {
  mode: DefaultRefMode;
  recentLimit: number;
  pinned: string[];
}

const PRIMARY_BRANCHES = new Set(['main', 'master', 'develop', 'dev', 'trunk', 'release']);
// History's default ref set is deliberately broader than the ref picker's mainline
// definition. The picker answers "what is the base branch?" (remote HEAD plus
// main/master fallback); history answers "which lines should be visible?" and
// includes long-lived integration branches such as develop/release.

function globToRegExp(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`, 'i');
}

function matches(ref: RefInfo, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(ref.shortName) || pattern.test(ref.name));
}

function byRecency(a: RefInfo, b: RefInfo): number {
  return b.committerDate - a.committerDate;
}

export function selectDefaultRefs(refs: RefInfo[], options: DefaultRefOptions): string[] {
  if (options.mode === 'all') {
    return [];
  }

  const pinned = options.pinned.filter(Boolean).map(globToRegExp);
  const selected = new Set<string>();
  const add = (ref: RefInfo | undefined) => {
    if (ref) {
      selected.add(ref.name);
    }
  };

  const current = refs.find((ref) => ref.current);
  if (current) {
    add(current);
  } else {
    selected.add('HEAD');
  }

  if (options.mode === 'primary') {
    for (const ref of refs) {
      if (ref.type === 'local' && PRIMARY_BRANCHES.has(ref.shortName)) {
        add(ref);
      }
    }

    if (current?.upstream) {
      add(
        refs.find(
          (ref) =>
            ref.type === 'remote' &&
            (ref.shortName === current.upstream || ref.name === `refs/remotes/${current.upstream}`)
        )
      );
    }

    const recent = refs
      .filter((ref) => ref.type === 'local' && !selected.has(ref.name))
      .sort(byRecency)
      .slice(0, Math.max(0, options.recentLimit));
    for (const ref of recent) {
      add(ref);
    }
  }

  for (const ref of refs) {
    if (pinned.length > 0 && matches(ref, pinned)) {
      add(ref);
    }
  }

  const onlyHead = selected.size === 1 && selected.has('HEAD');
  if (selected.size === 0 || (options.mode === 'primary' && onlyHead)) {
    for (const ref of refs
      .filter((candidate) => candidate.type === 'local')
      .sort(byRecency)
      .slice(0, Math.max(1, options.recentLimit))) {
      add(ref);
    }
  }

  return [...selected];
}
