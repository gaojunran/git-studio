import type { ChangeStatus, FileChange } from '../../shared/protocol';
import type { GitRunner } from './cli';

interface NameStatus {
  status: ChangeStatus;
  oldPath?: string;
}

interface NumStat {
  additions: number;
  deletions: number;
  binary: boolean;
}

function asStatus(value: string | undefined): ChangeStatus {
  const status = value?.[0];
  switch (status) {
    case 'A':
    case 'M':
    case 'D':
    case 'R':
    case 'C':
    case 'T':
    case 'U':
    case 'X':
      return status;
    default:
      return 'M';
  }
}

export function parseNameStatus(output: string): Map<string, NameStatus> {
  const tokens = output.split('\x00').filter((token) => token.length > 0);
  const result = new Map<string, NameStatus>();
  let index = 0;

  while (index < tokens.length) {
    const status = asStatus(tokens[index]);
    const statusToken = tokens[index] ?? '';
    index += 1;

    if (statusToken.startsWith('R') || statusToken.startsWith('C')) {
      const oldPath = tokens[index];
      const newPath = tokens[index + 1];
      index += 2;
      if (newPath) {
        result.set(newPath, { status, oldPath });
      }
    } else {
      const filePath = tokens[index];
      index += 1;
      if (filePath) {
        result.set(filePath, { status });
      }
    }
  }

  return result;
}

export function parseNumStat(output: string): Map<string, NumStat> {
  const tokens = output.split('\x00').filter((token) => token.length > 0);
  const result = new Map<string, NumStat>();
  let index = 0;

  while (index < tokens.length) {
    const token = tokens[index] ?? '';
    index += 1;
    const firstTab = token.indexOf('\t');
    const secondTab = token.indexOf('\t', firstTab + 1);
    if (firstTab === -1 || secondTab === -1) {
      continue;
    }

    const additionsRaw = token.slice(0, firstTab);
    const deletionsRaw = token.slice(firstTab + 1, secondTab);
    const filePath = token.slice(secondTab + 1);
    const binary = additionsRaw === '-' || deletionsRaw === '-';
    const stat: NumStat = {
      additions: binary ? 0 : Number(additionsRaw) || 0,
      deletions: binary ? 0 : Number(deletionsRaw) || 0,
      binary
    };

    if (filePath) {
      result.set(filePath, stat);
    } else {
      // Renames with -z put an empty path, then old path and new path as separate tokens.
      index += 1;
      const newPath = tokens[index];
      index += 1;
      if (newPath) {
        result.set(newPath, stat);
      }
    }
  }

  return result;
}

function mergeChanges(names: Map<string, NameStatus>, stats: Map<string, NumStat>): FileChange[] {
  const files: FileChange[] = [];
  for (const [filePath, entry] of names) {
    const stat = stats.get(filePath);
    files.push({
      path: filePath,
      oldPath: entry.oldPath,
      status: entry.status,
      additions: stat?.additions ?? 0,
      deletions: stat?.deletions ?? 0,
      binary: stat?.binary ?? false
    });
  }
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

export async function loadCommitFiles(
  runner: GitRunner,
  cwd: string,
  hash: string,
  parents: string[],
  signal?: AbortSignal
): Promise<FileChange[]> {
  const parent = parents[0];

  if (!parent) {
    const [names, stats] = await Promise.all([
      runner.run(['diff-tree', '--root', '--no-commit-id', '-r', '--name-status', '-z', '-M', hash], cwd, { signal }),
      runner.run(['diff-tree', '--root', '--no-commit-id', '-r', '--numstat', '-z', '-M', hash], cwd, { signal })
    ]);
    return mergeChanges(parseNameStatus(names), parseNumStat(stats));
  }

  const [names, stats] = await Promise.all([
    runner.run(['diff', '--name-status', '-z', '-M', '--no-color', parent, hash], cwd, { signal }),
    runner.run(['diff', '--numstat', '-z', '-M', '--no-color', parent, hash], cwd, { signal })
  ]);
  return mergeChanges(parseNameStatus(names), parseNumStat(stats));
}

export async function loadWorktreeFiles(
  runner: GitRunner,
  cwd: string,
  ref: string,
  signal?: AbortSignal
): Promise<FileChange[]> {
  const [names, stats, untracked] = await Promise.all([
    runner.run(['diff', '--name-status', '-z', '-M', '--no-color', ref], cwd, { signal }),
    runner.run(['diff', '--numstat', '-z', '-M', '--no-color', ref], cwd, { signal }),
    runner.run(['ls-files', '--others', '--exclude-standard', '-z'], cwd, { signal })
  ]);

  const changes = mergeChanges(parseNameStatus(names), parseNumStat(stats));
  const known = new Set(changes.map((change) => change.path));
  for (const filePath of untracked.split('\x00')) {
    if (filePath && !known.has(filePath)) {
      changes.push({ path: filePath, status: 'A', additions: 0, deletions: 0, binary: false });
    }
  }
  return changes.sort((a, b) => a.path.localeCompare(b.path));
}

export async function loadDiffFiles(
  runner: GitRunner,
  cwd: string,
  from: string | undefined,
  to: string,
  signal?: AbortSignal
): Promise<FileChange[]> {
  if (!from) {
    const stdout = await runner.run(['ls-tree', '-r', '--name-only', '-z', to], cwd, { signal });
    return stdout
      .split('\x00')
      .filter(Boolean)
      .map((filePath) => ({
        path: filePath,
        status: 'A' as const,
        additions: 0,
        deletions: 0,
        binary: false
      }))
      .sort((a, b) => a.path.localeCompare(b.path));
  }

  const [names, stats] = await Promise.all([
    runner.run(['diff', '--name-status', '-z', '-M', '--no-color', from, to], cwd, { signal }),
    runner.run(['diff', '--numstat', '-z', '-M', '--no-color', from, to], cwd, { signal })
  ]);
  return mergeChanges(parseNameStatus(names), parseNumStat(stats));
}
