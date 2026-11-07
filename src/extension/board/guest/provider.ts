import type {
  BoardAuthor,
  BoardComment,
  BoardItemDetail,
  BoardItemSummary,
  BoardKind,
  BoardListQuery,
  BoardListResult,
  BoardProviderInfo,
  BoardRepoInfo,
  BoardState
} from '../../../shared/board';
import { normalizeRemoteUrl } from '../../git/remote';
import type { BoardProvider } from '../github';
import type { GuestRecord } from './store';
import type { GuestService } from './service';

interface ScUser {
  id?: string | number;
  username?: string;
  login?: string;
  name?: string | null;
  avatarUrl?: string | null;
}

interface ScLabel {
  name: string;
  color?: string | null;
}

interface ScProject {
  id?: string;
  owner: string;
  name: string;
  url?: string;
}

interface ScIssue {
  id: string;
  number: number;
  project?: ScProject;
  title: string;
  body?: string;
  url: string;
  state: 'open' | 'closed';
  author?: ScUser | null;
  labels?: ScLabel[];
  createdAt?: string;
  updatedAt?: string;
}

interface ScChangeRequest extends Omit<ScIssue, 'state'> {
  state: 'open' | 'closed' | 'merged';
  draft: boolean;
  base: string;
  head: string;
  headSha?: string;
  mergeable?: boolean | null;
  reviewers?: ScUser[];
  additions?: number;
  deletions?: number;
}

interface ScComment {
  id: string;
  body: string;
  url?: string;
  author?: ScUser | null;
  createdAt?: string;
}

interface ScList<T> {
  items: T[];
  page?: number;
  hasMore?: boolean;
}

interface ScContext {
  changeRequest?: ScChangeRequest | null;
  issueComments?: ScComment[];
}

function loginOf(user: ScUser | null | undefined): BoardItemSummary['author'] {
  if (!user) {
    return null;
  }
  const login = user.username ?? user.login;
  if (!login) {
    return null;
  }
  return { login, name: user.name ?? null, avatarUrl: user.avatarUrl ?? null };
}

function labelsOf(labels: ScLabel[] | undefined): BoardItemSummary['labels'] {
  return (labels ?? []).map((label) => ({ name: label.name, color: label.color ?? null }));
}

function stateOf(value: string): BoardState {
  if (value === 'merged') return 'merged';
  if (value === 'closed') return 'closed';
  return 'open';
}

function timeOf(value: string | undefined): string {
  return value ?? new Date(0).toISOString();
}

export function guestRepoFor(record: GuestRecord, remote: string | undefined): BoardRepoInfo | undefined {
  if (!remote) {
    return undefined;
  }
  const normalized = normalizeRemoteUrl(remote);
  if (!normalized) {
    return undefined;
  }
  let remoteUrl: URL;
  let instanceUrl: URL;
  try {
    remoteUrl = new URL(normalized);
    instanceUrl = new URL(record.instance);
  } catch {
    return undefined;
  }
  if (remoteUrl.hostname.toLowerCase() !== instanceUrl.hostname.toLowerCase()) {
    return undefined;
  }
  const segments = remoteUrl.pathname.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);
  if (segments.length < 2) {
    return undefined;
  }
  const name = segments[segments.length - 1].replace(/\.git$/i, '');
  const owner = segments.slice(0, -1).join('/');
  return {
    root: '',
    owner,
    name,
    url: `${record.instance.replace(/\/+$/, '')}/${owner}/${name}`,
    providerId: `ext-${record.id}`,
    providerLabel: record.descriptor.label,
    kinds: kindsOf(record)
  };
}

function kindsOf(record: GuestRecord): BoardKind[] {
  const kinds: BoardKind[] = [];
  if (record.descriptor.capabilities.issues) {
    kinds.push('issue');
  }
  if (record.descriptor.capabilities.changeRequests) {
    kinds.push('pull');
  }
  return kinds;
}

export class GuestProvider implements BoardProvider {
  readonly info: BoardProviderInfo;
  readonly repo: BoardRepoInfo;

  constructor(
    private readonly record: GuestRecord,
    private readonly service: GuestService,
    repo: BoardRepoInfo
  ) {
    this.info = {
      id: `ext-${record.id}`,
      label: record.descriptor.label,
      kinds: kindsOf(record),
      builtin: false,
      packageRoot: record.packageRoot
    };
    this.repo = repo;
  }

  private input(extra: Record<string, unknown>): Record<string, unknown> {
    return {
      context: { repositoryId: this.repo.root, bindingRevision: 1, primaryRemote: 'origin' },
      directory: this.repo.root,
      remote: 'origin',
      ...extra
    };
  }

  private async call(method: string, input: Record<string, unknown>): Promise<unknown> {
    return this.service.request(this.record, method, this.input(input));
  }

  async list(query: BoardListQuery): Promise<BoardListResult> {
    if (query.kind === 'discussion') {
      throw new Error(`${this.record.descriptor.label} does not expose discussions.`);
    }
    const state = query.state === 'all' ? 'all' : query.state;
    const common = {
      page: query.page,
      state,
      people: 'all',
      query: query.search.trim()
    };
    if (query.kind === 'issue') {
      const result = (await this.call('listIssues', common)) as ScList<ScIssue>;
      return {
        items: this.filterSearch((result.items ?? []).map((issue) => this.issueSummary(issue)), query.search),
        hasMore: result.hasMore === true,
        page: result.page ?? query.page
      };
    }
    const result = (await this.call('listChangeRequests', common)) as ScList<ScChangeRequest>;
    return {
      items: this.filterSearch((result.items ?? []).map((pull) => this.pullSummary(pull)), query.search),
      hasMore: result.hasMore === true,
      page: result.page ?? query.page
    };
  }

  private filterSearch<T extends BoardItemSummary>(items: T[], search: string): T[] {
    const term = search.trim().toLowerCase();
    return term ? items.filter((item) => item.title.toLowerCase().includes(term)) : items;
  }

  private issueSummary(issue: ScIssue): BoardItemSummary {
    return {
      id: issue.id,
      kind: 'issue',
      number: issue.number,
      title: issue.title,
      state: stateOf(issue.state),
      author: loginOf(issue.author),
      labels: labelsOf(issue.labels),
      createdAt: timeOf(issue.createdAt),
      updatedAt: timeOf(issue.updatedAt),
      url: issue.url,
      commentCount: 0,
      answered: null,
      category: null
    };
  }

  private pullSummary(pull: ScChangeRequest): BoardItemSummary {
    return {
      id: pull.id,
      kind: 'pull',
      number: pull.number,
      title: pull.title,
      state: stateOf(pull.state),
      author: loginOf(pull.author),
      labels: labelsOf(pull.labels),
      createdAt: timeOf(pull.createdAt),
      updatedAt: timeOf(pull.updatedAt),
      url: pull.url,
      commentCount: 0,
      draft: pull.draft === true,
      answered: null,
      category: null
    };
  }

  private commentOf(comment: ScComment): BoardComment {
    return {
      id: comment.id,
      author: loginOf(comment.author),
      body: comment.body,
      createdAt: timeOf(comment.createdAt)
    };
  }

  private capabilities() {
    return this.record.descriptor.capabilities;
  }

  private mergeMethods(): string[] {
    const merge = this.record.descriptor.capabilities.merge;
    return merge && typeof merge === 'object' && Array.isArray(merge.methods) ? merge.methods : [];
  }

  private mutationContext(target: Record<string, unknown>): Record<string, unknown> {
    return {
      repositoryId: this.repo.root,
      bindingRevision: 1,
      primaryRemote: 'origin',
      directory: this.repo.root,
      target
    };
  }

  async detail(kind: BoardKind, number: number): Promise<BoardItemDetail> {
    const capabilities = this.capabilities();
    if (kind === 'issue') {
      const issue = (await this.call('getIssue', { number })) as ScIssue;
      const comments = (await this.call('issueComments', { number })) as ScComment[];
      return {
        ...this.issueSummary(issue),
        commentCount: comments.length,
        body: issue.body ?? '',
        comments: comments.map((comment) => this.commentOf(comment)),
        canComment: capabilities.comments === true,
        canClose: capabilities.state === true && issue.state === 'open',
        canReopen: capabilities.state === true && issue.state === 'closed',
        canMerge: false,
        canAnswer: false
      };
    }

    const context = (await this.call('changeRequestContext', {
      number,
      includeDiff: false,
      includeCIDetails: false,
      includeTimeline: false
    })) as ScContext;
    if (!context.changeRequest) {
      throw new Error(`Change request #${number} not found`);
    }
    const pull = context.changeRequest;
    const comments = context.issueComments ?? [];
    const methods = this.mergeMethods();
    return {
      ...this.pullSummary(pull),
      commentCount: comments.length,
      body: pull.body ?? '',
      comments: comments.map((comment) => this.commentOf(comment)),
      base: pull.base,
      head: pull.head,
      headSha: pull.headSha ?? null,
      additions: pull.additions ?? null,
      deletions: pull.deletions ?? null,
      mergeable: pull.mergeable ?? null,
      mergeMethods: methods,
      reviewers: (pull.reviewers ?? []).flatMap((user) => {
        const author = loginOf(user);
        return author ? [author] : [];
      }),
      canEditLabels: capabilities.labels === true,
      canEditReviewers: capabilities.reviewers === true,
      canReview: capabilities.reviews === true,
      reviewModel: capabilities.reviewModel ?? 'verdict',
      canComment: capabilities.comments === true,
      canClose: capabilities.state === true && pull.state === 'open',
      canReopen: capabilities.state === true && pull.state === 'closed',
      canMerge: methods.length > 0 && pull.state === 'open' && pull.draft !== true,
      canAnswer: false
    };
  }

  async comment(kind: BoardKind, number: number, body: string): Promise<void> {
    const issue = kind === 'issue';
    await this.service.mutate(
      this.record,
      issue ? 'issue-comment' : 'change-request-comment',
      { body },
      this.mutationContext({ number }),
      issue ? '/issues/comment' : '/pr/comment'
    );
  }

  async setState(kind: BoardKind, number: number, state: 'open' | 'closed'): Promise<void> {
    const issue = kind === 'issue';
    await this.service.mutate(
      this.record,
      issue ? 'issue-state' : 'change-request-state',
      { state },
      this.mutationContext({ number }),
      issue ? '/issues/state' : '/pr/state'
    );
  }

  async merge(number: number, method: 'merge' | 'squash' | 'rebase'): Promise<void> {
    const detail = await this.detail('pull', number);
    await this.service.mutate(
      this.record,
      'change-request-merge',
      { method },
      this.mutationContext({ number, head: detail.head, base: detail.base, headSha: detail.headSha }),
      '/pr/merge'
    );
  }

  async listLabels(): Promise<BoardItemSummary['labels']> {
    const result = (await this.call('listLabels', {
      project: { owner: this.repo.owner, name: this.repo.name }
    })) as ScLabel[] | { labels?: ScLabel[] };
    const labels = Array.isArray(result) ? result : result.labels ?? [];
    return labelsOf(labels);
  }

  async listReviewerCandidates(): Promise<BoardAuthor[]> {
    const result = (await this.call('listReviewerCandidates', {
      project: { owner: this.repo.owner, name: this.repo.name }
    })) as ScUser[] | { users?: ScUser[] };
    const users = Array.isArray(result) ? result : result.users ?? [];
    return users.flatMap((user) => {
      const author = loginOf(user);
      return author ? [author] : [];
    });
  }

  async setLabels(number: number, names: string[]): Promise<void> {
    await this.service.mutate(
      this.record,
      'change-request-labels',
      { names },
      this.mutationContext({ number }),
      '/pr/labels'
    );
  }

  async setReviewers(number: number, names: string[]): Promise<void> {
    await this.service.mutate(
      this.record,
      'change-request-reviewers',
      { names },
      this.mutationContext({ number }),
      '/pr/reviewers'
    );
  }

  async review(number: number, verdict: 'approve' | 'request-changes', body?: string): Promise<void> {
    await this.service.mutate(
      this.record,
      'change-request-review',
      body ? { verdict, body } : { verdict },
      this.mutationContext({ number }),
      '/pr/review'
    );
  }
}
