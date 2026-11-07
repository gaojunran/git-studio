import type { CommitRow } from '../../shared/protocol';
import type { GitRunner } from './cli';

export interface LogQuery {
  refs: string[];
  path?: string;
  follow?: boolean;
  author?: string;
  message?: string;
  regex?: boolean;
  caseSensitive?: boolean;
  firstParent?: boolean;
  noMerges?: boolean;
  since?: string;
  until?: string;
  order?: 'date' | 'topo';
  skip: number;
  limit: number;
}

const FIELD = '\x1f';
const RECORD = '\x00';
const FIELD_ESCAPE = '%x1f';
const RECORD_ESCAPE = '%x00';

export function logFormat(): string {
  return `%H${FIELD_ESCAPE}%h${FIELD_ESCAPE}%P${FIELD_ESCAPE}%an${FIELD_ESCAPE}%ae${FIELD_ESCAPE}%at${FIELD_ESCAPE}%ct${FIELD_ESCAPE}%D${FIELD_ESCAPE}%s${RECORD_ESCAPE}`;
}

export function parseLog(stdout: string): CommitRow[] {
  const rows: CommitRow[] = [];

  for (const raw of stdout.split(RECORD)) {
    const record = raw.replace(/^\n+/, '');
    if (!record) {
      continue;
    }
    const fields = record.split(FIELD);
    const hash = fields[0] ?? '';
    if (!hash) {
      continue;
    }
    rows.push({
      hash,
      shortHash: fields[1] ?? hash.slice(0, 7),
      parents: (fields[2] ?? '').split(' ').filter(Boolean),
      authorName: fields[3] ?? '',
      authorEmail: fields[4] ?? '',
      authorDate: Number(fields[5]) || 0,
      commitDate: Number(fields[6]) || 0,
      refs: (fields[7] ?? '')
        .split(', ')
        .map((ref) => ref.trim())
        .filter(Boolean),
      subject: fields[8] ?? ''
    });
  }

  return rows;
}

export function buildLogArgs(query: LogQuery): string[] {
  const args = [
    '-c', 'core.quotepath=false',
    '-c', 'color.ui=false',
    '-c', 'i18n.logOutputEncoding=UTF-8',
    'log',
    '--no-show-signature',
    '--decorate=short',
    query.order === 'topo' ? '--topo-order' : '--date-order'
  ];

  if (query.firstParent) {
    args.push('--first-parent');
  }
  if (query.noMerges) {
    args.push('--no-merges');
  }
  if (query.author?.trim()) {
    args.push(`--author=${query.author.trim()}`);
  }
  if (query.message?.trim()) {
    args.push(query.regex ? '--extended-regexp' : '--fixed-strings');
    if (!query.caseSensitive) {
      args.push('--regexp-ignore-case');
    }
    args.push(`--grep=${query.message.trim()}`);
  }
  if (query.since) {
    args.push(`--since=${query.since}`);
  }
  if (query.until) {
    args.push(`--until=${query.until}`);
  }
  if (query.path) {
    if (query.follow) {
      args.push('--follow');
    }
  }

  args.push(...(query.refs.length > 0 ? query.refs : ['--all']));
  args.push(`--max-count=${Math.max(1, query.limit + 1)}`);
  args.push(`--skip=${Math.max(0, query.skip)}`);
  args.push(`--format=${logFormat()}`);

  if (query.path) {
    args.push('--', `:(literal)${query.path}`);
  }

  return args;
}

export async function loadCommits(
  runner: GitRunner,
  cwd: string,
  query: LogQuery,
  signal?: AbortSignal
): Promise<{ rows: CommitRow[]; hasMore: boolean }> {
  const stdout = await runner.run(buildLogArgs(query), cwd, { signal });
  const rows = parseLog(stdout);
  return {
    rows: rows.slice(0, query.limit),
    hasMore: rows.length > query.limit
  };
}
