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

export interface GitLabRepo {
  base: string;
  owner: string;
  name: string;
}

interface GlUser {
  id: number;
  username: string;
  name?: string;
  avatar_url?: string | null;
}

interface GlLabel {
  name: string;
  color?: string | null;
}

interface GlIssue {
  id: number;
  iid: number;
  title: string;
  description?: string | null;
  state: 'opened' | 'closed';
  web_url: string;
  author?: GlUser | null;
  labels?: GlLabel[];
  created_at: string;
  updated_at: string;
  user_notes_count?: number;
}

interface GlMergeRequest extends GlIssue {
  draft?: boolean;
  source_branch?: string;
  target_branch?: string;
  sha?: string;
  merge_status?: string;
  has_conflicts?: boolean;
  changes_count?: string;
  reviewers?: GlUser[];
  squash?: boolean;
}

interface GlNote {
  id: number;
  body: string;
  created_at: string;
  author?: GlUser | null;
  system?: boolean;
}

function authorOf(user: GlUser | null | undefined): BoardAuthor | null {
  if (!user) {
    return null;
  }
  return { login: user.username, name: user.name ?? null, avatarUrl: user.avatar_url ?? null };
}

function labelsOf(labels: GlLabel[] | undefined): BoardLabel[] {
  return (labels ?? []).map((label) => ({ name: label.name, color: label.color ?? null }));
}

function stateOf(value: string): BoardState {
  return value === 'closed' || value === 'merged' ? 'closed' : 'open';
}

export class GitLabProvider implements BoardProvider {
  readonly info: BoardProviderInfo;
  readonly repo: BoardRepoInfo;
  private readonly project: string;

  constructor(
    private readonly token: string,
    private readonly target: GitLabRepo
  ) {
    this.project = encodeURIComponent(`${target.owner}/${target.name}`);
    this.info = {
      id: 'gitlab',
      label: 'GitLab',
      kinds: ['issue', 'pull'],
      builtin: true
    };
    this.repo = {
      root: '',
      owner: target.owner,
      name: target.name,
      url: `${target.base}/${target.owner}/${target.name}`,
      providerId: 'gitlab',
      providerLabel: 'GitLab',
      kinds: ['issue', 'pull']
    };
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(`${this.target.base}/api/v4${path}`, {
      ...init,
      headers: {
        accept: 'application/json',
        'PRIVATE-TOKEN': this.token,
        'content-type': 'application/json',
        ...(init.headers ?? {})
      }
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`GitLab ${response.status}: ${text.slice(0, 300)}`);
    }
    return (await response.json()) as T;
  }

  private summary(issue: GlIssue, kind: BoardKind): BoardItemSummary {
    return {
      id: `${kind}-${issue.iid}`,
      kind,
      number: issue.iid,
      title: issue.title,
      state: stateOf(issue.state),
      author: authorOf(issue.author),
      labels: labelsOf(issue.labels),
      updatedAt: issue.updated_at,
      createdAt: issue.created_at,
      url: issue.web_url,
      commentCount: issue.user_notes_count ?? 0,
      draft: (issue as GlMergeRequest).draft === true
    };
  }

  async list(query: BoardListQuery): Promise<BoardListResult> {
    const perPage = Math.max(1, Math.min(100, query.perPage));
    const state = query.state === 'all' ? 'all' : query.state === 'closed' ? 'closed' : 'opened';
    const search = query.search ? `&search=${encodeURIComponent(query.search)}` : '';
    const kind = query.kind === 'pull' ? 'merge_requests' : 'issues';
    const page = await this.request<GlIssue[]>(
      `/projects/${this.project}/${kind}?state=${state}&per_page=${perPage}&page=${query.page}${search}`
    );
    return {
      items: page.map((issue) => this.summary(issue, query.kind === 'pull' ? 'pull' : 'issue')),
      hasMore: page.length >= perPage,
      page: query.page
    };
  }

  private async notes(kind: BoardKind, number: number): Promise<GlNote[]> {
    const path = kind === 'pull' ? 'merge_requests' : 'issues';
    const notes = await this.request<GlNote[]>(`/projects/${this.project}/${path}/${number}/notes?per_page=100&sort=asc`);
    return notes.filter((note) => !note.system);
  }

  async detail(kind: BoardKind, number: number): Promise<BoardItemDetail> {
    const path = kind === 'pull' ? 'merge_requests' : 'issues';
    const [item, notes] = await Promise.all([
      this.request<GlMergeRequest>(`/projects/${this.project}/${path}/${number}`),
      this.notes(kind, number)
    ]);
    const base = {
      ...this.summary(item, kind),
      body: item.description ?? '',
      comments: notes.map((note) => ({
        id: String(note.id),
        author: authorOf(note.author),
        body: note.body,
        createdAt: note.created_at
      })),
      canComment: item.state === 'opened',
      canClose: item.state === 'opened',
      canReopen: item.state === 'closed',
      canMerge: kind === 'pull' && item.state === 'opened',
      canAnswer: false
    };
    if (kind === 'issue') {
      return base;
    }
    return {
      ...base,
      base: item.target_branch ?? null,
      head: item.source_branch ?? null,
      headSha: item.sha ?? null,
      mergeable: item.has_conflicts === true ? false : item.merge_status !== 'cannot_be_merged',
      mergeMethods: ['merge', 'squash'],
      reviewers: (item.reviewers ?? []).flatMap((user) => {
        const author = authorOf(user);
        return author ? [author] : [];
      }),
      canEditLabels: true,
      canEditReviewers: true,
      canReview: false,
      reviewModel: 'verdict'
    };
  }

  async comment(kind: BoardKind, number: number, body: string): Promise<void> {
    const path = kind === 'pull' ? 'merge_requests' : 'issues';
    await this.request(`/projects/${this.project}/${path}/${number}/notes`, {
      method: 'POST',
      body: JSON.stringify({ body })
    });
  }

  async setState(kind: BoardKind, number: number, state: 'open' | 'closed'): Promise<void> {
    const path = kind === 'pull' ? 'merge_requests' : 'issues';
    await this.request(`/projects/${this.project}/${path}/${number}`, {
      method: 'PUT',
      body: JSON.stringify({ state_event: state === 'closed' ? 'close' : 'reopen' })
    });
  }

  async merge(number: number, method: 'merge' | 'squash' | 'rebase'): Promise<void> {
    if (method === 'rebase') {
      throw new Error('GitLab does not support rebase merge through this API.');
    }
    await this.request(`/projects/${this.project}/merge_requests/${number}/merge`, {
      method: 'PUT',
      body: JSON.stringify(method === 'squash' ? { squash: true } : {})
    });
  }

  async listLabels(): Promise<BoardLabel[]> {
    const labels = await this.request<GlLabel[]>(`/projects/${this.project}/labels?per_page=100`);
    return labelsOf(labels);
  }

  async listReviewerCandidates(): Promise<BoardAuthor[]> {
    const members = await this.request<GlUser[]>(`/projects/${this.project}/members/all?per_page=100`);
    return members.flatMap((member) => {
      const author = authorOf(member);
      return author ? [author] : [];
    });
  }

  async setLabels(number: number, names: string[]): Promise<void> {
    await this.request(`/projects/${this.project}/issues/${number}`, {
      method: 'PUT',
      body: JSON.stringify({ labels: names.join(',') })
    });
  }

  async setReviewers(number: number, names: string[]): Promise<void> {
    const members = await this.request<GlUser[]>(`/projects/${this.project}/members/all?per_page=100`);
    const ids = members.filter((member) => names.includes(member.username)).map((member) => member.id);
    await this.request(`/projects/${this.project}/merge_requests/${number}`, {
      method: 'PUT',
      body: JSON.stringify({ reviewer_ids: ids })
    });
  }
}
