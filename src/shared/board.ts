export type BoardKind = 'issue' | 'pull' | 'discussion';
export type BoardState = 'open' | 'closed' | 'merged' | 'draft';
export type BoardStateFilter = 'open' | 'closed' | 'all';

export interface BoardLabel {
  name: string;
  color?: string | null;
}

export interface BoardAuthor {
  login: string;
  name?: string | null;
  avatarUrl?: string | null;
}

export interface BoardItemSummary {
  id: string;
  kind: BoardKind;
  number: number;
  title: string;
  state: BoardState;
  author: BoardAuthor | null;
  labels: BoardLabel[];
  updatedAt: string;
  createdAt: string;
  url: string;
  commentCount: number;
  draft?: boolean;
  answered?: boolean | null;
  category?: string | null;
}

export interface BoardComment {
  id: string;
  author: BoardAuthor | null;
  body: string;
  createdAt: string;
  isAnswer?: boolean;
  replyTo?: string | null;
}

export interface BoardItemDetail extends BoardItemSummary {
  body: string;
  comments: BoardComment[];
  base?: string | null;
  head?: string | null;
  headSha?: string | null;
  additions?: number | null;
  deletions?: number | null;
  mergeable?: boolean | null;
  mergeMethods?: string[];
  canComment: boolean;
  canClose: boolean;
  canReopen: boolean;
  canMerge: boolean;
  canAnswer: boolean;
}

export interface BoardListQuery {
  kind: BoardKind;
  state: BoardStateFilter;
  search: string;
  page: number;
  perPage: number;
}

export interface BoardListResult {
  items: BoardItemSummary[];
  hasMore: boolean;
  page: number;
}

export interface BoardProviderInfo {
  id: string;
  label: string;
  kinds: BoardKind[];
  builtin: boolean;
  /** OpenChamber guest package root, when this provider comes from an installed integration. */
  packageRoot?: string;
}

export interface BoardRepoInfo {
  root: string;
  owner: string;
  name: string;
  url: string;
  providerId: string;
  providerLabel: string;
  kinds: BoardKind[];
}

export interface BoardStateMessage {
  type: 'state';
  repo: BoardRepoInfo | null;
  providers: BoardProviderInfo[];
  providerId: string | null;
  authenticated: boolean;
  error?: string;
}

export interface BoardListMessage {
  type: 'list';
  requestId: number;
  result: BoardListResult;
}

export interface BoardDetailMessage {
  type: 'detail';
  requestId: number;
  detail: BoardItemDetail | null;
  error?: string;
}

export interface BoardBusyMessage {
  type: 'busy';
  busy: boolean;
  operation?: string;
}

export interface BoardErrorMessage {
  type: 'error';
  message: string;
  requestId?: number;
}

export type BoardHostMessage =
  | BoardStateMessage
  | BoardListMessage
  | BoardDetailMessage
  | BoardBusyMessage
  | BoardErrorMessage;

export type BoardWebviewMessage =
  | { type: 'ready' }
  | { type: 'refresh' }
  | { type: 'list'; requestId: number; query: BoardListQuery }
  | { type: 'detail'; requestId: number; kind: BoardKind; number: number }
  | { type: 'comment'; kind: BoardKind; number: number; body: string }
  | { type: 'setState'; kind: BoardKind; number: number; state: 'open' | 'closed' }
  | { type: 'merge'; number: number; method: 'merge' | 'squash' | 'rebase' }
  | { type: 'openExternal'; url: string }
  | { type: 'copy'; text: string }
  | { type: 'connectGithub' }
  | { type: 'connectProvider'; providerId: string }
  | { type: 'openSettings' };
