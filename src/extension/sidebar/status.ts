import type { ChangeStatus, SidebarFile } from '../../shared/sidebar';

export interface StatusSummary {
  branch: string | null;
  oid: string;
  upstream: string | null;
  ahead: number;
  behind: number;
  files: SidebarFile[];
}

function normalize(status: string): ChangeStatus {
  if (status.includes('U') || status === 'AA' || status === 'DD') {
    return 'U';
  }
  if (status.includes('R')) {
    return 'R';
  }
  if (status.includes('C')) {
    return 'C';
  }
  if (status.includes('A')) {
    return 'A';
  }
  if (status.includes('D')) {
    return 'D';
  }
  return 'M';
}

function file(path: string, status: string, staged: boolean, unstaged: boolean, conflict: boolean, oldPath?: string): SidebarFile {
  return {
    path,
    oldPath,
    status: status === '?' ? '?' : conflict ? 'U' : normalize(status),
    staged,
    unstaged,
    conflict,
    additions: 0,
    deletions: 0
  };
}

/** Parses `git status --porcelain=v2 --branch -z`. */
export function parseStatus(stdout: string): StatusSummary {
  const tokens = stdout.split('\0');
  const summary: StatusSummary = { branch: null, oid: '', upstream: null, ahead: 0, behind: 0, files: [] };

  for (let index = 0; index < tokens.length; index += 1) {
    const record = tokens[index];
    if (!record) {
      continue;
    }
    if (record.startsWith('# branch.oid ')) {
      summary.oid = record.slice('# branch.oid '.length).trim();
      continue;
    }
    if (record.startsWith('# branch.head ')) {
      const value = record.slice('# branch.head '.length).trim();
      summary.branch = value === '(detached)' ? null : value;
      continue;
    }
    if (record.startsWith('# branch.upstream ')) {
      summary.upstream = record.slice('# branch.upstream '.length).trim();
      continue;
    }
    if (record.startsWith('# branch.ab ')) {
      const match = /\+(\d+)\s+-(\d+)/.exec(record);
      if (match) {
        summary.ahead = Number(match[1]);
        summary.behind = Number(match[2]);
      }
      continue;
    }
    if (record.startsWith('? ')) {
      summary.files.push(file(record.slice(2), '?', false, true, false));
      continue;
    }
    if (record.startsWith('! ')) {
      continue;
    }
    if (record.startsWith('u ')) {
      const parts = record.split(' ');
      summary.files.push(file(parts.slice(10).join(' '), parts[1] ?? 'UU', false, true, true));
      continue;
    }
    if (record.startsWith('1 ')) {
      const parts = record.split(' ');
      const xy = parts[1] ?? '..';
      summary.files.push(file(parts.slice(8).join(' '), xy, xy[0] !== '.', xy[1] !== '.', false));
      continue;
    }
    if (record.startsWith('2 ')) {
      const parts = record.split(' ');
      const xy = parts[1] ?? '..';
      const oldPath = tokens[index + 1];
      index += 1;
      summary.files.push(file(parts.slice(9).join(' '), xy, xy[0] !== '.', xy[1] !== '.', false, oldPath || undefined));
    }
  }

  return summary;
}

export function groupSummary(files: SidebarFile[]): { staged: number; changes: number; untracked: number; conflicts: number } {
  return {
    staged: files.filter((item) => item.staged && !item.conflict).length,
    changes: files.filter((item) => item.unstaged && !item.conflict && item.status !== '?').length,
    untracked: files.filter((item) => item.status === '?').length,
    conflicts: files.filter((item) => item.conflict).length
  };
}
