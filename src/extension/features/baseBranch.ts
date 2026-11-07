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

  const value = computeInference(services, repo, refs, currentRef, currentOid).catch((error) => {
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
  currentRef: string,
  currentOid: string
): Promise<BaseInference> {
  const byName = new Map(refs.map((ref) => [ref.name, ref]));
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

  // 3. The closest branch whose tip is already contained in this branch.
  const containedOthers = [...contained]
    .map((name) => byName.get(name))
    .filter((ref): ref is RefInfo => Boolean(ref))
    .filter((ref) => ref.name !== currentRef && ref.oid !== currentOid)
    .filter((ref) => usable.some((candidate) => candidate.name === ref.name))
    .sort((a, b) => b.committerDate - a.committerDate)
    .slice(0, 5);

  if (containedOthers.length > 0) {
    const scored = await Promise.all(
      containedOthers.map(async (ref) => ({ ref, distance: await count(services, repo, `${ref.name}..${currentRef}`) }))
    );
    const best = scored
      .filter((entry) => entry.distance > 0)
      .sort((a, b) => a.distance - b.distance || b.ref.committerDate - a.ref.committerDate)[0];
    if (best) {
      return { guess: guessOf(best.ref, 'closest branch fully contained in the current branch'), contained };
    }
  }

  // 4. No contained branch: the most recent branch that still shares history.
  const recent = [...usable]
    .sort((a, b) => b.committerDate - a.committerDate)
    .slice(0, 5);
  for (const ref of recent) {
    const base = await services.runner
      .run(['merge-base', currentRef, ref.name], repo.root)
      .catch(() => '');
    if (base.trim()) {
      return { guess: guessOf(ref, 'most recent branch sharing history'), contained };
    }
  }

  return { contained };
}
