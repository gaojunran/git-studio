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

export interface GiteaRepo {
  base: string;
  owner: string;
  name: string;
}

interface GtUser {
  id: number;
  login: string;
  full_name?: string;
  avatar_url?: string | null;
}

interface GtLabel {
  name: string;
  color?: string | null;
}

interface GtIssue {
  id: number;
  number: number;
  title: string;
  body?: string | null;
  state: 'open' | 'closed';
  html_url: string;
  user?: GtUser | null;
  labels?: GtLabel[];
  created_at: string;
  updated_at: string;
  comments?: number;
  pull_request?: unknown;
}

interface GtPull extends GtIssue {
  head?: { ref: string; sha: string };
  base?: { ref: string };
  merged?: boolean;
  mergeable?: boolean;
  additions?: number;
  deletions?: number;
}

interface GtComment {
  id: number;
  body: string;
  created_at: string;
  user?: GtUser | null;
}

function authorOf(user: GtUser | null | undefined): BoardAuthor | null {
  if (!user) {
    return null;
  }
  return { login: user.login, name: user.full_name ?? null, avatarUrl: user.avatar_url ?? null };
}

function labelsOf(labels: GtLabel[] | undefined): BoardLabel[] {
  return (labels ?? []).map((label) => ({ name: label.name, color: label.color ?? null }));
}

function stateOf(value: string): BoardState {
  return value === 'closed' ? 'closed' : 'open';
}

export class GiteaProvider implements BoardProvider {
  readonly info: BoardProviderInfo;
  readonly repo: BoardRepoInfo;

  constructor(
    private readonly token: string,
    private readonly target: GiteaRepo
  ) {
    this.info = {
      id: 'gitea',
      label: 'Gitea',
      kinds: ['issue', 'pull'],
      builtin: true
    };
    this.repo = {
      root: '',
      owner: target.owner,
      name: target.name,
      url: `${target.base}/${target.owner}/${target.name}`,
      providerId: 'gitea',
      providerLabel: 'Gitea',
      kinds: ['issue', 'pull']
    };
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(`${this.target.base}/api/v1/repos/${this.target.owner}/${this.target.name}${path}`, {
      ...init,
      headers: {
        accept: 'application/json',
        authorization: `token ${this.token}`,
        'content-type': 'application/json',
        ...(init.headers ?? {})
      }
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`Gitea ${response.status}: ${text.slice(0, 300)}`);
    }
    return (await response.json()) as T;
  }

  private summary(issue: GtIssue, kind: BoardKind): BoardItemSummary {
    return {
      id: `${kind}-${issue.number}`,
      kind,
      number: issue.number,
      title: issue.title,
      state: stateOf(issue.state),
      author: authorOf(issue.user),
      labels: labelsOf(issue.labels),
      updatedAt: issue.updated_at,
      createdAt: issue.created_at,
      url: issue.html_url,
      commentCount: issue.comments ?? 0
    };
  }

  async list(query: BoardListQuery): Promise<BoardListResult> {
    const limit = Math.max(1, Math.min(50, query.perPage));
    const state = query.state === 'all' ? 'all' : query.state === 'closed' ? 'closed' : 'open';
    const search = query.search ? `&q=${encodeURIComponent(query.search)}` : '';
    const kind = query.kind === 'pull' ? 'pulls' : 'issues';
    const page = await this.request<GtIssue[]>(`/${kind}?state=${state}&limit=${limit}&page=${query.page}${search}`);
    return {
      items: page.map((issue) => this.summary(issue, query.kind === 'pull' ? 'pull' : 'issue')),
      hasMore: page.length >= limit,
      page: query.page
    };
  }

  async detail(kind: BoardKind, number: number): Promise<BoardItemDetail> {
    const path = kind === 'pull' ? 'pulls' : 'issues';
    const [item, comments] = await Promise.all([
      this.request<GtPull>(`/${path}/${number}`),
      this.request<GtComment[]>(`/issues/${number}/comments?limit=100`)
    ]);
    const base = {
      ...this.summary(item, kind),
      body: item.body ?? '',
      comments: comments.map((comment) => ({
        id: String(comment.id),
        author: authorOf(comment.user),
        body: comment.body,
        createdAt: comment.created_at
      })),
      canComment: item.state === 'open',
      canClose: item.state === 'open',
      canReopen: item.state === 'closed',
      canMerge: kind === 'pull' && item.state === 'open',
      canAnswer: false
    };
    if (kind === 'issue') {
      return base;
    }
    return {
      ...base,
      base: item.base?.ref ?? null,
      head: item.head?.ref ?? null,
      headSha: item.head?.sha ?? null,
      additions: item.additions ?? null,
      deletions: item.deletions ?? null,
      mergeable: item.mergeable ?? null,
      mergeMethods: ['merge', 'squash', 'rebase'],
      canEditLabels: true,
      canEditReviewers: false,
      canReview: false,
      reviewModel: 'verdict'
    };
  }

  async comment(_kind: BoardKind, number: number, body: string): Promise<void> {
    await this.request(`/issues/${number}/comments`, {
      method: 'POST',
      body: JSON.stringify({ body })
    });
  }

  async setState(kind: BoardKind, number: number, state: 'open' | 'closed'): Promise<void> {
    const path = kind === 'pull' ? 'pulls' : 'issues';
    await this.request(`/${path}/${number}`, {
      method: 'PATCH',
      body: JSON.stringify({ state })
    });
  }

  async merge(number: number, method: 'merge' | 'squash' | 'rebase'): Promise<void> {
    await this.request(`/pulls/${number}/merge`, {
      method: 'POST',
      body: JSON.stringify({ Do: method })
    });
  }

  async listLabels(): Promise<BoardLabel[]> {
    const labels = await this.request<GtLabel[]>('/labels?limit=100');
    return labelsOf(labels);
  }

  async listReviewerCandidates(): Promise<BoardAuthor[]> {
    const users = await this.request<GtUser[]>('/collaborators?limit=100').catch(() => []);
    return users.flatMap((user) => {
      const author = authorOf(user);
      return author ? [author] : [];
    });
  }

  async setLabels(number: number, names: string[]): Promise<void> {
    await this.request(`/issues/${number}/labels`, {
      method: 'PUT',
      body: JSON.stringify({ labels: names })
    });
  }
}
