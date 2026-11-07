import type {
  BoardAuthor,
  BoardItemDetail,
  BoardItemSummary,
  BoardKind,
  BoardLabel,
  BoardListQuery,
  BoardListResult,
  BoardProviderInfo,
  BoardRepoInfo,
  BoardState
} from '../../shared/board';
import type { BoardProvider } from './github';

export interface GerritRepo {
  base: string;
  owner: string;
  name: string;
}

interface GrAccount {
  _account_id?: number;
  name?: string;
  email?: string;
  username?: string;
}

interface GrChange {
  id: string;
  _number: number;
  project: string;
  branch: string;
  subject: string;
  status: 'NEW' | 'MERGED' | 'ABANDONED';
  owner?: GrAccount;
  updated: string;
  created?: string;
  url?: string;
  insertions?: number;
  deletions?: number;
  current_revision?: string;
  revisions?: Record<string, { _number: number; created: string; commit?: { message?: string } }>;
}

interface GrMessage {
  id: string;
  message: string;
  date: string;
  author?: GrAccount;
}

function authorOf(account: GrAccount | undefined): BoardAuthor | null {
  if (!account) {
    return null;
  }
  const login = account.username ?? account.email ?? account.name;
  return login ? { login, name: account.name ?? null, avatarUrl: null } : null;
}

function stateOf(status: GrChange['status']): BoardState {
  return status === 'NEW' ? 'open' : 'closed';
}

export class GerritProvider implements BoardProvider {
  readonly info: BoardProviderInfo;
  readonly repo: BoardRepoInfo;

  constructor(
    private readonly token: string,
    private readonly target: GerritRepo
  ) {
    this.info = { id: 'gerrit', label: 'Gerrit', kinds: ['pull'], builtin: true };
    this.repo = {
      root: '',
      owner: target.owner,
      name: target.name,
      url: `${target.base}/${target.owner}/${target.name}`,
      providerId: 'gerrit',
      providerLabel: 'Gerrit',
      kinds: ['pull']
    };
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(`${this.target.base}${path}`, {
      ...init,
      headers: {
        accept: 'application/json',
        ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
        'content-type': 'application/json',
        ...(init.headers ?? {})
      }
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`Gerrit ${response.status}: ${text.slice(0, 300)}`);
    }
    const text = (await response.text()).replace(/^\)\]\}'\n?/, '');
    return JSON.parse(text) as T;
  }

  private summary(change: GrChange): BoardItemSummary {
    return {
      id: `gerrit-${change._number}`,
      kind: 'pull',
      number: change._number,
      title: change.subject,
      state: stateOf(change.status),
      author: authorOf(change.owner),
      labels: [{ name: change.branch, color: null }],
      updatedAt: change.updated,
      createdAt: change.created ?? change.updated,
      url: `${this.target.base}/c/${change.project}/+/${change._number}`,
      commentCount: 0
    };
  }

  async list(query: BoardListQuery): Promise<BoardListResult> {
    const status = query.state === 'closed' ? 'status:merged OR status:abandoned' : query.state === 'all' ? '' : 'status:open';
    const search = query.search ? ` message:${encodeURIComponent(query.search)}` : '';
    const n = Math.max(1, Math.min(100, query.perPage));
    const start = (query.page - 1) * n;
    const changes = await this.request<GrChange[]>(
      `/changes/?q=${encodeURIComponent(`project:${this.target.owner}/${this.target.name} ${status}${search}`)}&n=${n}&start=${start}&o=DETAILED_ACCOUNTS&o=CURRENT_REVISION`
    );
    return { items: changes.map((change) => this.summary(change)), hasMore: changes.length >= n, page: query.page };
  }

  async detail(kind: BoardKind, number: number): Promise<BoardItemDetail> {
    if (kind !== 'pull') {
      throw new Error('Gerrit only exposes changes.');
    }
    const change = await this.request<GrChange>(`/changes/${number}/detail?o=DETAILED_ACCOUNTS&o=CURRENT_REVISION&o=MESSAGES`);
    const messages = ((change as unknown as { messages?: GrMessage[] }).messages ?? []).filter((message) => message.message.trim());
    return {
      ...this.summary(change),
      body: change.revisions?.[change.current_revision ?? '']?.commit?.message ?? '',
      comments: messages.map((message) => ({
        id: message.id,
        author: authorOf(message.author),
        body: message.message,
        createdAt: message.date
      })),
      base: change.branch,
      head: change.branch,
      headSha: change.current_revision ?? null,
      additions: change.insertions ?? null,
      deletions: change.deletions ?? null,
      mergeMethods: ['rebase'],
      canComment: change.status === 'NEW',
      canClose: change.status === 'NEW',
      canReopen: change.status === 'ABANDONED',
      canMerge: change.status === 'NEW',
      canAnswer: false
    };
  }

  async comment(_kind: BoardKind, number: number, body: string): Promise<void> {
    await this.request(`/changes/${number}/revisions/current/review`, {
      method: 'POST',
      body: JSON.stringify({ message: body })
    });
  }

  async setState(_kind: BoardKind, number: number, state: 'open' | 'closed'): Promise<void> {
    await this.request(`/changes/${number}/${state === 'closed' ? 'abandon' : 'restore'}`, {
      method: 'POST',
      body: JSON.stringify({})
    });
  }

  async merge(number: number): Promise<void> {
    await this.request(`/changes/${number}/submit`, { method: 'POST', body: JSON.stringify({}) });
  }

  async listLabels(): Promise<BoardLabel[]> {
    return [];
  }
}
