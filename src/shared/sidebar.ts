import type { RefInfo, RepoSummary } from './protocol';

export type ChangeStatus = 'M' | 'A' | 'D' | 'R' | 'C' | 'U' | '?';

export interface SidebarFile {
  path: string;
  oldPath?: string;
  status: ChangeStatus;
  staged: boolean;
  unstaged: boolean;
  conflict: boolean;
  additions: number;
  deletions: number;
}

export interface SidebarOperation {
  kind: 'merge' | 'rebase' | 'cherry-pick' | 'revert' | 'bisect' | 'unknown';
  canContinue: boolean;
  canSkip: boolean;
}

export interface SidebarState {
  repo: RepoSummary;
  repos: RepoSummary[];
  files: SidebarFile[];
  branch: string | null;
  detached: boolean;
  upstream: string | null;
  ahead: number;
  behind: number;
  operation: SidebarOperation | null;
  commitMessage: string;
}

export interface SidebarBranches {
  current: string | null;
  refs: RefInfo[];
}

export type SidebarMessage =
  | { type: 'ready' }
  | { type: 'refresh' }
  | { type: 'selectRepo'; root: string }
  | { type: 'stage'; paths: string[] }
  | { type: 'unstage'; paths: string[] }
  | { type: 'discard'; paths: string[] }
  | { type: 'stageAll' }
  | { type: 'unstageAll' }
  | { type: 'discardAll' }
  | { type: 'openDiff'; path: string; staged: boolean; conflict?: boolean }
  | { type: 'openFile'; path: string }
  | { type: 'reveal'; path: string }
  | { type: 'copyPath'; path: string }
  | { type: 'commit'; message: string; mode: 'staged' | 'all'; amend: boolean; push: boolean }
  | { type: 'pickBranch' }
  | { type: 'createBranch' }
  | { type: 'renameBranch' }
  | { type: 'deleteBranch' }
  | { type: 'sync'; action: 'fetch' | 'pull' | 'push' | 'publish'; rebase?: boolean }
  | { type: 'operation'; action: 'continue' | 'skip' | 'abort' }
  | { type: 'stash'; mode: 'all' | 'staged' | 'untracked' }
  | { type: 'openStashes' }
  | { type: 'openWorktrees' }
  | { type: 'openHistory' }
  | { type: 'openBoard' };

export type SidebarHostMessage =
  | { type: 'state'; state: SidebarState }
  | { type: 'busy'; busy: boolean }
  | { type: 'error'; message: string }
  | { type: 'toast'; message: string };
