import type { RefInfo, RefType } from '../../shared/protocol';
import type { GitRunner } from './cli';

const FIELD = '\x1f';
const RECORD = '\x1e';

function stripPrefix(name: string, prefix: string): string {
  return name.startsWith(prefix) ? name.slice(prefix.length) : name;
}

export function parseRefs(stdout: string): RefInfo[] {
  const refs: RefInfo[] = [];

  for (const raw of stdout.split(RECORD)) {
    const record = raw.replace(/^\n+/, '');
    if (!record) {
      continue;
    }
    const [name = '', oid = '', upstream = '', head = '', committerDate = '0'] = record.split(FIELD);
    if (!name || !oid) {
      continue;
    }

    let type: RefType;
    let shortName: string;
    if (name.startsWith('refs/heads/')) {
      type = 'local';
      shortName = stripPrefix(name, 'refs/heads/');
    } else if (name.startsWith('refs/remotes/')) {
      if (name.endsWith('/HEAD')) {
        continue;
      }
      type = 'remote';
      shortName = stripPrefix(name, 'refs/remotes/');
    } else if (name.startsWith('refs/tags/')) {
      type = 'tag';
      shortName = stripPrefix(name, 'refs/tags/');
    } else {
      continue;
    }

    refs.push({
      name,
      shortName,
      type: head === '*' ? 'head' : type,
      oid,
      committerDate: Number(committerDate) || 0,
      upstream: upstream || undefined,
      current: head === '*'
    });
  }

  const order: Record<RefType, number> = { head: 0, local: 1, remote: 2, tag: 3, other: 4 };
  return refs.sort((a, b) => {
    if (a.current !== b.current) {
      return a.current ? -1 : 1;
    }
    return order[a.type] - order[b.type] || a.shortName.localeCompare(b.shortName);
  });
}

export async function loadRefs(
  runner: GitRunner,
  cwd: string,
  signal?: AbortSignal
): Promise<RefInfo[]> {
  const stdout = await runner.run(
    [
      'for-each-ref',
      `--format=%(refname)${FIELD}%(objectname)${FIELD}%(upstream:short)${FIELD}%(HEAD)${FIELD}%(committerdate:unix)${RECORD}`,
      'refs/heads',
      'refs/remotes',
      'refs/tags'
    ],
    cwd,
    { signal }
  );
  return parseRefs(stdout);
}
