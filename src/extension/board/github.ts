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
import { normalizeRemoteUrl } from '../git/remote';

const API = 'https://api.github.com';
const GRAPHQL = 'https://api.github.com/graphql';

export interface BoardProvider {
  readonly info: BoardProviderInfo;
  readonly repo: BoardRepoInfo;
  list(query: BoardListQuery): Promise<BoardListResult>;
  detail(kind: BoardKind, number: number): Promise<BoardItemDetail>;
  comment(kind: BoardKind, number: number, body: string): Promise<void>;
  setState(kind: BoardKind, number: number, state: 'open' | 'closed'): Promise<void>;
  merge(number: number, method: 'merge' | 'squash' | 'rebase'): Promise<void>;
  listLabels?(): Promise<BoardLabel[]>;
  listReviewerCandidates?(): Promise<BoardAuthor[]>;
  setLabels?(number: number, names: string[]): Promise<void>;
  setReviewers?(number: number, names: string[]): Promise<void>;
  review?(number: number, verdict: 'approve' | 'request-changes', body?: string): Promise<void>;
}

export interface GitHubRepo {
  owner: string;
  name: string;
  url: string;
}

export function parseGitHubRemote(raw: string | undefined): GitHubRepo | undefined {
  if (!raw) {
    return undefined;
  }
  const normalized = normalizeRemoteUrl(raw);
  if (!normalized) {
    return undefined;
  }
  let url: URL;
  try {
    url = new URL(normalized);
  } catch {
    return undefined;
  }
  if (url.hostname.toLowerCase() !== 'github.com') {
    return undefined;
  }
  const [owner, name] = url.pathname.replace(/^\/+|\/+$/g, '').split('/');
  if (!owner || !name) {
    return undefined;
  }
  return { owner, name, url: `${API}/repos/${owner}/${name}` };
}

interface GitHubUser {
  login: string;
  avatar_url?: string;
}

interface GitHubLabel {
  name: string;
  color?: string | null;
}

interface GitHubIssue {
  id: number;
  number: number;
  title: string;
  state: 'open' | 'closed';
  body?: string | null;
  html_url: string;
  user?: GitHubUser | null;
  labels?: GitHubLabel[];
  created_at: string;
  updated_at: string;
  comments?: number;
  pull_request?: unknown;
  draft?: boolean;
}

interface GitHubPull extends GitHubIssue {
  draft?: boolean;
  mergeable?: boolean | null;
  base?: { ref: string };
  head?: { ref: string; sha?: string };
  requested_reviewers?: GitHubUser[];
  additions?: number;
  deletions?: number;
  merged?: boolean;
}

interface GitHubComment {
  id: number;
  body: string;
  created_at: string;
  user?: GitHubUser | null;
}

interface GitHubDiscussionNode {
  id: string;
  number: number;
  title: string;
  url: string;
  closed: boolean;
  createdAt: string;
  updatedAt: string;
  author?: { login: string; avatarUrl?: string } | null;
  category?: { name: string } | null;
  comments?: { totalCount?: number };
  answer?: { id: string } | null;
}

interface GitHubDiscussionComment {
  id: string;
  body: string;
  createdAt: string;
  isAnswer?: boolean;
  replyTo?: { id: string } | null;
  author?: { login: string; avatarUrl?: string } | null;
}

interface GitHubDiscussionDetail extends Omit<GitHubDiscussionNode, 'comments'> {
  body: string;
  comments: { nodes: GitHubDiscussionComment[] };
}

function authorOf(user: GitHubUser | null | undefined): BoardItemSummary['author'] {
  if (!user) {
    return null;
  }
  return { login: user.login, avatarUrl: user.avatar_url ?? null };
}

function labelsOf(labels: GitHubLabel[] | undefined): BoardItemSummary['labels'] {
  return (labels ?? []).map((label) => ({ name: label.name, color: label.color ?? null }));
}

function stateOf(value: string): BoardState {
  if (value === 'merged') {
    return 'merged';
  }
  if (value === 'closed') {
    return 'closed';
  }
  return 'open';
}

export class GitHubProvider implements BoardProvider {
  readonly info: BoardProviderInfo = {
    id: 'github',
    label: 'GitHub',
    kinds: ['issue', 'pull', 'discussion'],
    builtin: true
  };

  readonly repo: BoardRepoInfo;

  constructor(
    private readonly token: string,
    private readonly github: GitHubRepo
  ) {
    this.repo = {
      root: '',
      owner: github.owner,
      name: github.name,
      url: `https://github.com/${github.owner}/${github.name}`,
      providerId: this.info.id,
      providerLabel: this.info.label,
      kinds: this.info.kinds
    };
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(`${API}${path}`, {
      ...init,
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${this.token}`,
        'x-github-api-version': '2022-11-28',
        'content-type': 'application/json',
        ...(init.headers ?? {})
      }
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`GitHub ${response.status}: ${text.slice(0, 300)}`);
    }
    return (await response.json()) as T;
  }

  private async graphql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    const response = await fetch(GRAPHQL, {
      method: 'POST',
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${this.token}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({ query, variables })
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`GitHub GraphQL ${response.status}: ${text.slice(0, 300)}`);
    }
    const payload = (await response.json()) as { data?: T; errors?: { message: string }[] };
    if (payload.errors?.length) {
      throw new Error(`GitHub GraphQL: ${payload.errors.map((error) => error.message).join('; ')}`);
    }
    if (!payload.data) {
      throw new Error('GitHub GraphQL returned no data');
    }
    return payload.data;
  }

  private issueSummary(issue: GitHubIssue, kind: BoardKind): BoardItemSummary {
    return {
      id: String(issue.id),
      kind,
      number: issue.number,
      title: issue.title,
      state: stateOf(issue.state),
      author: authorOf(issue.user),
      labels: labelsOf(issue.labels),
      createdAt: issue.created_at,
      updatedAt: issue.updated_at,
      url: issue.html_url,
      commentCount: issue.comments ?? 0,
      draft: issue.draft === true,
      answered: null,
      category: null
    };
  }

  private pullSummary(pull: GitHubPull): BoardItemSummary {
    return {
      ...this.issueSummary(pull, 'pull'),
      state: pull.merged ? 'merged' : stateOf(pull.state),
      draft: pull.draft === true
    };
  }

  private discussionSummary(node: GitHubDiscussionNode): BoardItemSummary {
    return {
      id: node.id,
      kind: 'discussion',
      number: node.number,
      title: node.title,
      state: node.closed ? 'closed' : 'open',
      author: node.author ? { login: node.author.login, avatarUrl: node.author.avatarUrl ?? null } : null,
      labels: [],
      createdAt: node.createdAt,
      updatedAt: node.updatedAt,
      url: node.url,
      commentCount: node.comments?.totalCount ?? 0,
      answered: Boolean(node.answer),
      category: node.category?.name ?? null
    };
  }

  private async listIssues(query: BoardListQuery): Promise<BoardListResult> {
    const state = query.state === 'all' ? 'all' : query.state;
    if (query.search.trim()) {
      const search = encodeURIComponent(`repo:${this.github.owner}/${this.github.name} is:issue ${query.search.trim()}`);
      const stateQuery = state === 'all' ? '' : ` state:${state}`;
      const result = await this.request<{ items: GitHubIssue[]; total_count: number }>(
        `/search/issues?q=${search}${encodeURIComponent(stateQuery)}&per_page=${query.perPage}&page=${query.page}`
      );
      return {
        items: result.items.map((issue) => this.issueSummary(issue, 'issue')),
        hasMore: query.page * query.perPage < result.total_count,
        page: query.page
      };
    }
    const items = await this.request<GitHubIssue[]>(
      `/repos/${this.github.owner}/${this.github.name}/issues?state=${state}&per_page=${query.perPage}&page=${query.page}&sort=updated&direction=desc`
    );
    const issues = items.filter((item) => !item.pull_request);
    return { items: issues.map((issue) => this.issueSummary(issue, 'issue')), hasMore: items.length === query.perPage, page: query.page };
  }

  private async listPulls(query: BoardListQuery): Promise<BoardListResult> {
    const state = query.state === 'all' ? 'all' : query.state;
    if (query.search.trim()) {
      const search = encodeURIComponent(`repo:${this.github.owner}/${this.github.name} is:pr ${query.search.trim()}`);
      const stateQuery = state === 'all' ? '' : ` state:${state}`;
      const result = await this.request<{ items: GitHubPull[]; total_count: number }>(
        `/search/issues?q=${search}${encodeURIComponent(stateQuery)}&per_page=${query.perPage}&page=${query.page}`
      );
      return {
        items: result.items.map((pull) => this.pullSummary(pull)),
        hasMore: query.page * query.perPage < result.total_count,
        page: query.page
      };
    }
    const items = await this.request<GitHubPull[]>(
      `/repos/${this.github.owner}/${this.github.name}/pulls?state=${state}&per_page=${query.perPage}&page=${query.page}&sort=updated&direction=desc`
    );
    return { items: items.map((pull) => this.pullSummary(pull)), hasMore: items.length === query.perPage, page: query.page };
  }

  private async listDiscussions(query: BoardListQuery): Promise<BoardListResult> {
    const data = await this.graphql<{
      repository: {
        discussions: {
          totalCount: number;
          pageInfo: { hasNextPage: boolean; endCursor: string | null };
          nodes: GitHubDiscussionNode[];
        };
      };
    }>(
      `query($owner: String!, $name: String!, $first: Int!) {
        repository(owner: $owner, name: $name) {
          discussions(first: $first, orderBy: { field: UPDATED_AT, direction: DESC }) {
            totalCount
            pageInfo { hasNextPage endCursor }
            nodes { id number title url closed createdAt updatedAt author { login avatarUrl } category { name } comments { totalCount } answer { id } }
          }
        }
      }`,
      { owner: this.github.owner, name: this.github.name, first: Math.min(100, query.page * query.perPage) }
    );
    const nodes = data.repository.discussions.nodes
      .filter((node) => {
        if (query.state === 'open' && node.closed) return false;
        if (query.state === 'closed' && !node.closed) return false;
        const term = query.search.trim().toLowerCase();
        return !term || node.title.toLowerCase().includes(term);
      })
      .slice((query.page - 1) * query.perPage, query.page * query.perPage);
    return {
      items: nodes.map((node) => this.discussionSummary(node)),
      hasMore: data.repository.discussions.totalCount > query.page * query.perPage,
      page: query.page
    };
  }

  async list(query: BoardListQuery): Promise<BoardListResult> {
    if (query.kind === 'issue') return this.listIssues(query);
    if (query.kind === 'pull') return this.listPulls(query);
    return this.listDiscussions(query);
  }

  private async detailIssue(number: number): Promise<BoardItemDetail> {
    const issue = await this.request<GitHubIssue>(`/repos/${this.github.owner}/${this.github.name}/issues/${number}`);
    const comments = await this.request<GitHubComment[]>(
      `/repos/${this.github.owner}/${this.github.name}/issues/${number}/comments?per_page=100`
    );
    return {
      ...this.issueSummary(issue, 'issue'),
      body: issue.body ?? '',
      comments: comments.map((comment) => ({
        id: String(comment.id),
        author: authorOf(comment.user),
        body: comment.body,
        createdAt: comment.created_at
      })),
      canComment: true,
      canClose: issue.state === 'open',
      canReopen: issue.state === 'closed',
      canMerge: false,
      canAnswer: false
    };
  }

  private async detailPull(number: number): Promise<BoardItemDetail> {
    const pull = await this.request<GitHubPull>(`/repos/${this.github.owner}/${this.github.name}/pulls/${number}`);
    const comments = await this.request<GitHubComment[]>(
      `/repos/${this.github.owner}/${this.github.name}/issues/${number}/comments?per_page=100`
    );
    return {
      ...this.pullSummary(pull),
      body: pull.body ?? '',
      comments: comments.map((comment) => ({
        id: String(comment.id),
        author: authorOf(comment.user),
        body: comment.body,
        createdAt: comment.created_at
      })),
      base: pull.base?.ref ?? null,
      head: pull.head?.ref ?? null,
      headSha: pull.head?.sha ?? null,
      additions: pull.additions ?? null,
      deletions: pull.deletions ?? null,
      mergeable: pull.mergeable ?? null,
      mergeMethods: ['merge', 'squash', 'rebase'],
      reviewers: (pull.requested_reviewers ?? []).map((user) => authorOf(user)).filter((author): author is NonNullable<typeof author> => author !== null),
      canEditLabels: true,
      canEditReviewers: true,
      canReview: true,
      reviewModel: 'verdict',
      canComment: true,
      canClose: pull.state === 'open' && !pull.merged,
      canReopen: pull.state === 'closed' && !pull.merged,
      canMerge: pull.state === 'open' && !pull.draft,
      canAnswer: false
    };
  }

  private async detailDiscussion(number: number): Promise<BoardItemDetail> {
    const data = await this.graphql<{ repository: { discussion: GitHubDiscussionDetail | null } }>(
      `query($owner: String!, $name: String!, $number: Int!) {
        repository(owner: $owner, name: $name) {
          discussion(number: $number) {
            id number title url closed createdAt updatedAt body
            author { login avatarUrl }
            category { name }
            answer { id }
            comments(first: 100) { nodes { id body createdAt isAnswer replyTo { id } author { login avatarUrl } } }
          }
        }
      }`,
      { owner: this.github.owner, name: this.github.name, number }
    );
    const discussion = data.repository.discussion;
    if (!discussion) {
      throw new Error(`Discussion #${number} not found`);
    }
    return {
      ...this.discussionSummary({ ...discussion, comments: { totalCount: discussion.comments.nodes.length } }),
      body: discussion.body,
      comments: discussion.comments.nodes.map((comment) => ({
        id: comment.id,
        author: comment.author ? { login: comment.author.login, avatarUrl: comment.author.avatarUrl ?? null } : null,
        body: comment.body,
        createdAt: comment.createdAt,
        isAnswer: comment.isAnswer === true,
        replyTo: comment.replyTo?.id ?? null
      })),
      canComment: !discussion.closed,
      canClose: !discussion.closed,
      canReopen: discussion.closed,
      canMerge: false,
      canAnswer: !discussion.closed
    };
  }

  async detail(kind: BoardKind, number: number): Promise<BoardItemDetail> {
    if (kind === 'issue') return this.detailIssue(number);
    if (kind === 'pull') return this.detailPull(number);
    return this.detailDiscussion(number);
  }

  async comment(kind: BoardKind, number: number, body: string): Promise<void> {
    if (kind === 'discussion') {
      const data = await this.graphql<{ repository: { discussion: { id: string } | null } }>(
        `query($owner: String!, $name: String!, $number: Int!) {
          repository(owner: $owner, name: $name) { discussion(number: $number) { id } }
        }`,
        { owner: this.github.owner, name: this.github.name, number }
      );
      const discussion = data.repository.discussion;
      if (!discussion) {
        throw new Error(`Discussion #${number} not found`);
      }
      await this.graphql(
        `mutation($discussionId: ID!, $body: String!) {
          addDiscussionComment(input: { discussionId: $discussionId, body: $body }) { comment { id } }
        }`,
        { discussionId: discussion.id, body }
      );
      return;
    }
    await this.request(`/repos/${this.github.owner}/${this.github.name}/issues/${number}/comments`, {
      method: 'POST',
      body: JSON.stringify({ body })
    });
  }

  async setState(kind: BoardKind, number: number, state: 'open' | 'closed'): Promise<void> {
    if (kind === 'discussion') {
      const data = await this.graphql<{ repository: { discussion: { id: string } | null } }>(
        `query($owner: String!, $name: String!, $number: Int!) {
          repository(owner: $owner, name: $name) { discussion(number: $number) { id } }
        }`,
        { owner: this.github.owner, name: this.github.name, number }
      );
      const discussion = data.repository.discussion;
      if (!discussion) {
        throw new Error(`Discussion #${number} not found`);
      }
      if (state === 'closed') {
        await this.graphql(
          `mutation($discussionId: ID!) { closeDiscussion(input: { discussionId: $discussionId, reason: OUTDATED }) { discussion { closed } } }`,
          { discussionId: discussion.id }
        );
      } else {
        await this.graphql(
          `mutation($discussionId: ID!) { reopenDiscussion(input: { discussionId: $discussionId }) { discussion { closed } } }`,
          { discussionId: discussion.id }
        );
      }
      return;
    }
    await this.request(`/repos/${this.github.owner}/${this.github.name}/issues/${number}`, {
      method: 'PATCH',
      body: JSON.stringify({ state })
    });
  }

  async merge(number: number, method: 'merge' | 'squash' | 'rebase'): Promise<void> {
    await this.request(`/repos/${this.github.owner}/${this.github.name}/pulls/${number}/merge`, {
      method: 'PUT',
      body: JSON.stringify({ merge_method: method })
    });
  }

  async listLabels(): Promise<BoardLabel[]> {
    const labels = await this.request<GitHubLabel[]>(`/repos/${this.github.owner}/${this.github.name}/labels?per_page=100`);
    return labels.map((label) => ({ name: label.name, color: label.color ?? null }));
  }

  async listReviewerCandidates(): Promise<BoardAuthor[]> {
    let users: GitHubUser[];
    try {
      users = await this.request<GitHubUser[]>(`/repos/${this.github.owner}/${this.github.name}/collaborators?per_page=100`);
    } catch {
      users = await this.request<GitHubUser[]>(`/repos/${this.github.owner}/${this.github.name}/assignees?per_page=100`);
    }
    return users.flatMap((user) => {
      const author = authorOf(user);
      return author ? [author] : [];
    });
  }

  async setLabels(number: number, names: string[]): Promise<void> {
    await this.request(`/repos/${this.github.owner}/${this.github.name}/issues/${number}/labels`, {
      method: 'PUT',
      body: JSON.stringify({ labels: names })
    });
  }

  async setReviewers(number: number, names: string[]): Promise<void> {
    const pull = await this.request<GitHubPull>(`/repos/${this.github.owner}/${this.github.name}/pulls/${number}`);
    const current = new Set((pull.requested_reviewers ?? []).map((user) => user.login));
    const next = new Set(names);
    const removed = [...current].filter((login) => !next.has(login));
    const added = [...next].filter((login) => !current.has(login));
    if (removed.length > 0) {
      await this.request(`/repos/${this.github.owner}/${this.github.name}/pulls/${number}/requested_reviewers`, {
        method: 'DELETE',
        body: JSON.stringify({ reviewers: removed })
      });
    }
    if (added.length > 0) {
      await this.request(`/repos/${this.github.owner}/${this.github.name}/pulls/${number}/requested_reviewers`, {
        method: 'POST',
        body: JSON.stringify({ reviewers: added })
      });
    }
  }

  async review(number: number, verdict: 'approve' | 'request-changes', body?: string): Promise<void> {
    await this.request(`/repos/${this.github.owner}/${this.github.name}/pulls/${number}/reviews`, {
      method: 'POST',
      body: JSON.stringify({
        event: verdict === 'approve' ? 'APPROVE' : 'REQUEST_CHANGES',
        ...(body ? { body } : {})
      })
    });
  }
}
