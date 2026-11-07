import type { RefInfo } from '../../shared/protocol';
import type { RepoHandle } from '../host/repoService';
import type { Services } from '../host/services';

export interface BaseGuess {
  ref: string;
  label: string;
  reason: string;
}

const MAINLINE = /^(main|master|develop|dev|trunk|next|stable|release(\/.*)?)$/i;

function isBranch(ref: RefInfo): boolean {
  return ref.type === 'local' || ref.type === 'head' || ref.type === 'remote';
}

export function branchBaseName(ref: RefInfo): string {
  if (ref.type !== 'remote') {
    return ref.shortName;
  }
  const slash = ref.shortName.indexOf('/');
  return slash === -1 ? ref.shortName : ref.shortName.slice(slash + 1);
}

export function mainlineRank(ref: RefInfo): number {
  const base = branchBaseName(ref).toLowerCase();
  const names = ['main', 'master', 'develop', 'dev', 'trunk', 'next', 'stable'];
  const exact = names.indexOf(base);
  if (exact !== -1) {
    return exact;
  }
  if (base === 'release' || base.startsWith('release/')) {
    return names.length;
  }
  return Number.MAX_SAFE_INTEGER;
}

export function isMainline(ref: RefInfo): boolean {
  return isBranch(ref) && MAINLINE.test(branchBaseName(ref));
}

export async function loadMainlines(services: Services, repo: RepoHandle, refs: RefInfo[]): Promise<RefInfo[]> {
  const originHead = (await services.runner
    .run(['symbolic-ref', '--short', '-q', 'refs/remotes/origin/HEAD'], repo.root)
    .catch(() => ''))
    .trim();

  return refs
    .filter((ref) => isMainline(ref) || (originHead !== '' && ref.shortName === originHead))
    .sort((a, b) => mainlineRank(a) - mainlineRank(b) || a.shortName.localeCompare(b.shortName));
}

async function count(services: Services, repo: RepoHandle, range: string): Promise<number> {
  const output = await services.runner.run(['rev-list', '--count', range], repo.root).catch(() => '0');
  return Number(output.trim()) || 0;
}

function findRef(source: string, refs: RefInfo[], usable: RefInfo[]): RefInfo | undefined {
  const trimmed = source.trim();
  if (!trimmed || trimmed === 'HEAD') {
    return undefined;
  }

  const direct = refs.find((ref) => ref.name === trimmed || ref.shortName === trimmed);
  if (direct) {
    return usable.find((ref) => ref.name === direct.name);
  }

  if (/^[0-9a-f]{7,40}$/i.test(trimmed)) {
    const matches = usable.filter((ref) => ref.oid.toLowerCase().startsWith(trimmed.toLowerCase()));
    return matches.sort(
      (a, b) => mainlineRank(a) - mainlineRank(b) || (a.type === 'local' ? -1 : 1)
    )[0];
  }

  return usable.find(
    (ref) =>
      ref.shortName === trimmed ||
      ref.name === `refs/heads/${trimmed}` ||
      ref.name === `refs/remotes/${trimmed}`
  );
}

export async function inferBaseRef(
  services: Services,
  repo: RepoHandle,
  refs: RefInfo[],
  currentRef: string
): Promise<BaseGuess | undefined> {
  const byName = new Map(refs.map((ref) => [ref.name, ref]));
  const current = byName.get(currentRef);
  const currentShort = currentRef.startsWith('refs/heads/') ? currentRef.slice('refs/heads/'.length) : undefined;
  const currentIsMainline = current ? isMainline(current) : false;
  const currentOid = (await services.runner.run(['rev-parse', '--verify', currentRef], repo.root).catch(() => '')).trim();

  const usable = refs.filter((ref) => {
    if (!isBranch(ref) || ref.name === currentRef) {
      return false;
    }
    if (currentShort && !currentIsMainline && ref.type === 'remote' && branchBaseName(ref) === currentShort) {
      return false;
    }
    return true;
  });

  // 1. The branch reflog records where this branch was created from.
  const reflog = await services.runner
    .run(['reflog', '--format=%gs', '-n', '120', currentRef], repo.root)
    .catch(() => '');
  for (const line of reflog.split('\n')) {
    const created = line.match(/^branch: Created from (.+)$/);
    if (!created) {
      continue;
    }
    const match = findRef(created[1], refs, usable);
    if (match) {
      return { ref: match.name, label: match.shortName, reason: `created from ${created[1]}` };
    }
  }

  // 2. A tracking upstream that is not the same-named remote branch.
  if (currentShort) {
    const upstream = (await services.runner
      .run(['rev-parse', '--abbrev-ref', `${currentShort}@{upstream}`], repo.root)
      .catch(() => ''))
      .trim();
    if (upstream) {
      const match = usable.find((ref) => ref.shortName === upstream || ref.name === `refs/remotes/${upstream}`);
      if (match) {
        return { ref: match.name, label: match.shortName, reason: `upstream of ${currentShort}` };
      }
    }
  }

  // 3. The closest branch that is fully contained in the current branch. Prefer mainlines.
  const mergedNames = (await services.runner
    .run(['for-each-ref', '--merged', currentRef, '--format=%(refname)', 'refs/heads', 'refs/remotes'], repo.root)
    .catch(() => ''))
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const merged = mergedNames
    .map((name) => byName.get(name))
    .filter((ref): ref is RefInfo => Boolean(ref))
    .filter((ref) => usable.some((candidate) => candidate.name === ref.name))
    .filter((ref) => !currentOid || ref.oid !== currentOid)
    .sort((a, b) => mainlineRank(a) - mainlineRank(b) || b.committerDate - a.committerDate)
    .slice(0, 20);

  const closestMerged = async (candidates: RefInfo[]): Promise<BaseGuess | undefined> => {
    let best: { ref: RefInfo; distance: number } | undefined;
    for (const ref of candidates) {
      const distance = await count(services, repo, `${ref.name}..${currentRef}`);
      if (distance === 0) {
        continue;
      }
      if (
        !best ||
        distance < best.distance ||
        (distance === best.distance &&
          (mainlineRank(ref) < mainlineRank(best.ref) || ref.committerDate > best.ref.committerDate))
      ) {
        best = { ref, distance };
      }
    }
    return best
      ? {
          ref: best.ref.name,
          label: best.ref.shortName,
          reason: 'closest branch fully contained in the current branch'
        }
      : undefined;
  };

  const mergedMainlines = merged.filter(isMainline);
  const mergedGuess = (await closestMerged(mergedMainlines)) ?? (await closestMerged(merged));
  if (mergedGuess) {
    return mergedGuess;
  }

  // 4. Closest mainline to the merge base (covers branches whose base has moved on).
  const mainlines = usable
    .filter(isMainline)
    .sort((a, b) => mainlineRank(a) - mainlineRank(b) || b.committerDate - a.committerDate)
    .slice(0, 10);

  let best: { ref: RefInfo; behind: number } | undefined;
  for (const ref of mainlines) {
    const mergeBase = (await services.runner
      .run(['merge-base', currentRef, ref.name], repo.root)
      .catch(() => ''))
      .trim()
      .split('\n')[0];
    if (!mergeBase) {
      continue;
    }
    const behind = await count(services, repo, `${mergeBase}..${ref.name}`);
    if (
      !best ||
      behind < best.behind ||
      (behind === best.behind &&
        (mainlineRank(ref) < mainlineRank(best.ref) || ref.committerDate > best.ref.committerDate))
    ) {
      best = { ref, behind };
    }
  }
  if (best) {
    return {
      ref: best.ref.name,
      label: best.ref.shortName,
      reason: 'closest mainline to the merge base'
    };
  }

  return undefined;
}
