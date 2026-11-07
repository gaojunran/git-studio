import type { RefInfo } from '../../shared/protocol';
import type { RepoHandle } from '../host/repoService';
import type { Services } from '../host/services';

export interface BaseGuess {
  ref: string;
  label: string;
  reason: string;
}

export interface BaseInference {
  guess?: BaseGuess;
  contained: Set<string>;
}

export interface BaseCandidateStat {
  ref: RefInfo;
  /** Commits on the current branch since the fork point. */
  currentAhead: number;
  /** Commits on the candidate branch since the fork point; informational only. */
  candidateAhead: number;
}

const MAINLINE = /^(main|master)$/i;
const CACHE_TTL_MS = 10_000;

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
  const names = ['main', 'master'];
  const exact = names.indexOf(base);
  return exact === -1 ? Number.MAX_SAFE_INTEGER : exact;
}

export function isMainline(ref: RefInfo): boolean {
  return isBranch(ref) && MAINLINE.test(branchBaseName(ref));
}

/** Most recently updated first; name rank only breaks ties. */
export function sortMainlines(refs: RefInfo[]): RefInfo[] {
  return [...refs].sort(
    (a, b) =>
      b.committerDate - a.committerDate ||
      mainlineRank(a) - mainlineRank(b) ||
      a.shortName.localeCompare(b.shortName)
  );
}

/**
 * Mainlines are a display concern only.
 * Remote HEAD targets are authoritative; without them fall back to main/master.
 */
export async function loadMainlines(services: Services, repo: RepoHandle, refs: RefInfo[]): Promise<RefInfo[]> {
  const defaultHeads = (await services.runner
    .run(['for-each-ref', '--format=%(symref:short)', 'refs/remotes/*/HEAD'], repo.root)
    .catch(() => ''))
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  if (defaultHeads.length > 0) {
    return sortMainlines(refs.filter((ref) => defaultHeads.includes(ref.shortName)));
  }

  return sortMainlines(refs.filter((ref) => isMainline(ref)));
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
      (a, b) =>
        (a.type === 'local' ? -1 : 1) - (b.type === 'local' ? -1 : 1) ||
        b.committerDate - a.committerDate
    )[0];
  }

  return usable.find(
    (ref) =>
      ref.shortName === trimmed ||
      ref.name === `refs/heads/${trimmed}` ||
      ref.name === `refs/remotes/${trimmed}`
  );
}

function guessOf(ref: RefInfo, reason: string): BaseGuess {
  return { ref: ref.name, label: ref.shortName, reason };
}

/** Closest fork point first, then the most recently updated branch, then name. */
export function rankBaseCandidates(stats: BaseCandidateStat[]): BaseCandidateStat[] {
  return [...stats].sort(
    (a, b) =>
      a.currentAhead - b.currentAhead ||
      b.ref.committerDate - a.ref.committerDate ||
      a.ref.shortName.localeCompare(b.ref.shortName)
  );
}

const cache = new Map<string, { at: number; value: Promise<BaseInference> }>();

export function inferBaseRef(
  services: Services,
  repo: RepoHandle,
  refs: RefInfo[],
  currentRef: string
): Promise<BaseInference> {
  const currentOid = refs.find((ref) => ref.name === currentRef)?.oid ?? '';
  const key = `${repo.root}|${currentRef}|${currentOid}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    return hit.value;
  }

  const value = computeInference(services, repo, refs, currentRef).catch((error) => {
    cache.delete(key);
    throw error;
  });
  cache.set(key, { at: Date.now(), value });
  return value;
}

async function computeInference(
  services: Services,
  repo: RepoHandle,
  refs: RefInfo[],
  currentRef: string
): Promise<BaseInference> {
  const currentShort = currentRef.startsWith('refs/heads/')
    ? currentRef.slice('refs/heads/'.length)
    : undefined;

  const usable = refs.filter((ref) => {
    if (!isBranch(ref) || ref.name === currentRef) {
      return false;
    }
    // The same-named remote branch is a copy of the current branch, not a base.
    if (currentShort && ref.type === 'remote' && branchBaseName(ref) === currentShort) {
      return false;
    }
    return true;
  });

  const [reflog, upstream, mergedNames] = await Promise.all([
    services.runner.run(['reflog', '--format=%gs', '-n', '80', currentRef], repo.root).catch(() => ''),
    currentShort
      ? services.runner
          .run(['rev-parse', '--abbrev-ref', `${currentShort}@{upstream}`], repo.root)
          .catch(() => '')
      : Promise.resolve(''),
    services.runner
      .run(
        ['for-each-ref', '--merged', currentRef, '--format=%(refname)', 'refs/heads', 'refs/remotes'],
        repo.root
      )
      .catch(() => '')
  ]);

  const contained = new Set(
    mergedNames
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
  );

  // 1. A tracking upstream is the most direct statement of intent.
  const upstreamName = upstream.trim();
  if (upstreamName) {
    const match = usable.find(
      (ref) => ref.shortName === upstreamName || ref.name === `refs/remotes/${upstreamName}`
    );
    if (match) {
      return { guess: guessOf(match, `upstream of ${currentShort}`), contained };
    }
  }

  // 2. The branch reflog records where the branch was created from.
  for (const line of reflog.split('\n')) {
    const created = line.match(/^branch: Created from (.+)$/);
    if (!created) {
      continue;
    }
    const match = findRef(created[1], refs, usable);
    if (match) {
      return { guess: guessOf(match, `created from ${created[1]}`), contained };
    }
  }

  // 3. No explicit signal: compare fork points instead of requiring containment,
  // so a base branch that has moved on still participates.
  const candidates = [...usable]
    .sort((a, b) => b.committerDate - a.committerDate)
    .slice(0, 20);

  const stats = (
    await Promise.all(
      candidates.map(async (ref) => {
        const output = await services.runner
          .run(['rev-list', '--count', '--left-right', `${currentRef}...${ref.name}`], repo.root)
          .catch(() => '');
        const [currentAhead, candidateAhead] = output
          .trim()
          .split(/\s+/)
          .map((value) => Number(value));
        if (!Number.isFinite(currentAhead) || !Number.isFinite(candidateAhead)) {
          return undefined;
        }
        // Same commit: not a useful base, the diff would only be the working tree.
        if (currentAhead === 0 && candidateAhead === 0) {
          return undefined;
        }
        // A local branch strictly ahead of the current branch is most likely a child
        // branch created from it, not its base. Remote branches may legitimately be ahead.
        if (currentAhead === 0 && ref.type !== 'remote') {
          return undefined;
        }
        return { ref, currentAhead, candidateAhead };
      })
    )
  ).filter((entry): entry is BaseCandidateStat => entry !== undefined);

  const best = rankBaseCandidates(stats)[0];
  if (best) {
    return { guess: guessOf(best.ref, 'closest fork point'), contained };
  }

  return { contained };
}
