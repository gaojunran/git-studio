/** Types shared by the extension host and the history webview. */

export type RefType = 'head' | 'local' | 'remote' | 'tag' | 'other';

export interface RefInfo {
  /** Full ref name, e.g. refs/heads/main. */
  name: string;
  /** Display name, e.g. main or origin/main. */
  shortName: string;
  type: RefType;
  oid: string;
  /** Unix seconds of the last commit on the ref. */
  committerDate: number;
  upstream?: string;
  /** Subject of the commit the ref points at. */
  subject?: string;
  current: boolean;
}

export interface Filters {
  /** Full ref names. Empty means "all refs". */
  refs: string[];
  /** Repository-relative path. Empty means no path filter. */
  path: string;
  author: string;
  message: string;
  regex: boolean;
  caseSensitive: boolean;
  firstParent: boolean;
  noMerges: boolean;
  collapseLinear: boolean;
  since: string;
  until: string;
  order: 'date' | 'topo';
}

export interface CommitRow {
  hash: string;
  shortHash: string;
  subject: string;
  authorName: string;
  authorEmail: string;
  /** Unix seconds. */
  authorDate: number;
  /** Unix seconds. */
  commitDate: number;
  parents: string[];
  /** Decorations reported by git, e.g. HEAD -> main, tag: v1.0. */
  refs: string[];
}

export interface GraphSegment {
  from: number;
  to: number;
  color: number;
}

export interface GraphRow {
  lane: number;
  color: number;
  /** Segments drawn from this row's center to the next row's center. */
  segments: GraphSegment[];
}

export type ChangeStatus = 'A' | 'M' | 'D' | 'R' | 'C' | 'T' | 'U' | 'X';

export interface FileChange {
  path: string;
  oldPath?: string;
  status: ChangeStatus;
  additions: number;
  deletions: number;
  binary: boolean;
}

export interface CommitItemLink {
  providerId: string;
  providerLabel: string;
  kind: 'issue' | 'pull' | 'discussion';
  number: number;
  title: string;
  state: string;
  url: string;
}

export interface CommitDetail {
  hash: string;
  message: string;
  parents: string[];
  parentIndex: number;
  authorName: string;
  authorEmail: string;
  authorDate: number;
  committerName: string;
  committerEmail: string;
  commitDate: number;
  signature: string | null;
  signer: string | null;
  /** Branches and tags that point at this commit. */
  contains: string[];
  files: FileChange[];
  additions: number;
  deletions: number;
}

export interface RepoSummary {
  name: string;
  root: string;
  kind: string;
  branch: string | null;
  detached: boolean;
}

export type RebaseAction = 'pick' | 'reword' | 'edit' | 'squash' | 'fixup' | 'drop';

export interface RebaseItem {
  hash: string;
  shortHash: string;
  subject: string;
  action: RebaseAction;
  /** Replacement message for reword. */
  message?: string;
}

export interface RebasePlan {
  head: string;
  target: string;
  targetShort: string;
  branch: string | null;
  items: RebaseItem[];
  error?: string;
}

export interface UndoInfo {
  label: string;
  before: string;
  after: string;
  branch: string | null;
}

export interface InitState {
  repo: RepoSummary;
  repos: RepoSummary[];
  refs: RefInfo[];
  filters: Filters;
  filePath: string | null;
  pageSize: number;
  /** Merge, rebase, cherry-pick or revert currently in progress. */
  operation: string | null;
  undo: UndoInfo | null;
}

export interface CommitQuery {
  filters: Filters;
  skip: number;
  limit: number;
}

export type HostMessage =
  | { type: 'init'; state: InitState }
  | { type: 'commits'; requestId: number; append: boolean; rows: CommitRow[]; graph: GraphRow[]; hasMore: boolean; stale: boolean }
  | { type: 'detail'; hash: string; detail: CommitDetail | null; error?: string }
  | { type: 'commitItems'; hash: string; items: CommitItemLink[] }
  | { type: 'filters'; filters: Filters }
  | { type: 'focusCommit'; hash: string }
  | { type: 'operation'; operation: string | null }
  | { type: 'rebasePlan'; plan: RebasePlan }
  | { type: 'undo'; undo: UndoInfo | null }
  | { type: 'busy'; busy: boolean }
  | { type: 'error'; requestId?: number; message: string };

export type WebviewMessage =
  | { type: 'ready' }
  | { type: 'query'; requestId: number; append: boolean; filters: Filters; skip: number; limit: number }
  | { type: 'selectCommit'; hash: string; parentIndex?: number }
  | { type: 'openFileDiff'; hash: string; path: string; oldPath?: string; status: ChangeStatus }
  | { type: 'openFileWithLocal'; hash: string; path: string; oldPath?: string; status: ChangeStatus; before?: boolean }
  | { type: 'getFileFromRevision'; hash: string; path: string }
  | { type: 'openCommitChanges'; hash: string }
  | { type: 'commitActions'; hash: string }
  | { type: 'abortOperation' }
  | { type: 'continueOperation' }
  | { type: 'skipOperation' }
  | { type: 'undoLastRewrite' }
  | { type: 'rebasePlan'; hash: string }
  | { type: 'startRebase'; plan: RebasePlan }
  | { type: 'compare'; a: string; b: string }
  | { type: 'openFileHistory'; path: string; hash: string }
  | { type: 'openFileAtRevision'; hash: string; path: string }
  | { type: 'pickerRefs' }
  | { type: 'pickerRepo' }
  | { type: 'refresh' }
  | { type: 'copy'; text: string }
  | { type: 'openBoardItem'; providerId?: string; kind: 'issue' | 'pull' | 'discussion'; number: number }
  | { type: 'openSettings' };
