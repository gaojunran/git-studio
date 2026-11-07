import type {
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
  mergeable?: boolean | null;
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

  async detail(kind: BoardKind, number: number): Promise<BoardItemDetail> {
    if (kind === 'issue') {
      const issue = (await this.call('getIssue', { number })) as ScIssue;
      const comments = (await this.call('issueComments', { number })) as ScComment[];
      return {
        ...this.issueSummary(issue),
        commentCount: comments.length,
        body: issue.body ?? '',
        comments: comments.map((comment) => this.commentOf(comment)),
        canComment: false,
        canClose: false,
        canReopen: false,
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
    const comments = context.issueComments ?? [];
    return {
      ...this.pullSummary(context.changeRequest),
      commentCount: comments.length,
      body: context.changeRequest.body ?? '',
      comments: comments.map((comment) => this.commentOf(comment)),
      base: context.changeRequest.base,
      head: context.changeRequest.head,
      additions: context.changeRequest.additions ?? null,
      deletions: context.changeRequest.deletions ?? null,
      mergeable: context.changeRequest.mergeable ?? null,
      canComment: false,
      canClose: false,
      canReopen: false,
      canMerge: false,
      canAnswer: false
    };
  }

  async comment(): Promise<void> {
    throw new Error('Writing through an integration provider is not available yet.');
  }

  async setState(): Promise<void> {
    throw new Error('Writing through an integration provider is not available yet.');
  }

  async merge(): Promise<void> {
    throw new Error('Writing through an integration provider is not available yet.');
  }
}
