import type {
  BoardAuthor,
  BoardComment,
  BoardLabel,
  BoardTrackerDetail,
  BoardTrackerItem,
  BoardTrackerListResult,
  BoardTrackerPriority,
  BoardTrackerStateCategory
} from '../../../shared/board';
import type { TrackerGuestRecord } from './store';
import type { GuestService } from './service';

interface TrackerUser {
  name?: string;
  username?: string;
  login?: string;
  avatarUrl?: string | null;
}

interface TrackerLabel {
  id?: string;
  name: string;
  color?: string | null;
}

interface TrackerState {
  id?: string;
  name: string;
  category?: BoardTrackerStateCategory;
}

interface TrackerContainer {
  id: string;
  key: string;
  name: string;
}

interface TrackerSummary {
  id: string;
  identifier: string;
  title: string;
  url: string;
  state?: TrackerState | null;
  priority?: BoardTrackerPriority;
  labels?: TrackerLabel[];
  assignee?: TrackerUser | null;
  container?: TrackerContainer | null;
  updatedAt?: string;
}

interface TrackerItem extends TrackerSummary {
  description?: string | null;
  comments?: Array<{
    id: string;
    body: string;
    createdAt?: string | null;
    author?: TrackerUser | null;
  }>;
  children?: TrackerSummary[];
}

interface TrackerListAnswer {
  items?: TrackerSummary[];
  cursor?: string | null;
  hasMore?: boolean;
}

function authorOf(user: TrackerUser | null | undefined): BoardAuthor | null {
  if (!user) {
    return null;
  }
  const login = user.username ?? user.login ?? user.name;
  if (!login) {
    return null;
  }
  return { login, name: user.name ?? null, avatarUrl: user.avatarUrl ?? null };
}

function labelsOf(labels: TrackerLabel[] | undefined): BoardLabel[] {
  return (labels ?? []).map((label) => ({ name: label.name, color: label.color ?? null }));
}

function itemOf(raw: TrackerSummary): BoardTrackerItem {
  return {
    id: raw.id,
    identifier: raw.identifier,
    title: raw.title,
    url: raw.url,
    state: raw.state ? { id: raw.state.id, name: raw.state.name, category: raw.state.category ?? null } : null,
    priority: raw.priority ?? 'none',
    labels: labelsOf(raw.labels),
    assignee: authorOf(raw.assignee),
    container: raw.container ?? null,
    updatedAt: raw.updatedAt ?? ''
  };
}

function commentOf(raw: NonNullable<TrackerItem['comments']>[number]): BoardComment {
  return {
    id: raw.id,
    body: raw.body,
    createdAt: raw.createdAt ?? '',
    author: authorOf(raw.author)
  };
}

export class TrackerProvider {
  constructor(
    private readonly record: TrackerGuestRecord,
    private readonly service: GuestService
  ) {}

  private async call<T>(method: string, input: Record<string, unknown>): Promise<T> {
    return (await this.service.request(this.record, method, input)) as T;
  }

  async list(state: string, cursor?: string | null): Promise<BoardTrackerListResult> {
    const answer = await this.call<TrackerListAnswer>('items.list', {
      state,
      people: 'any',
      priority: 'all',
      ...(cursor ? { cursor } : {})
    });
    return {
      items: (answer.items ?? []).map(itemOf),
      cursor: answer.cursor ?? null,
      hasMore: answer.hasMore === true
    };
  }

  async detail(id: string): Promise<BoardTrackerDetail | null> {
    const answer = await this.call<{ item?: TrackerItem | null }>('items.get', { id });
    if (!answer.item) {
      return null;
    }
    return {
      ...itemOf(answer.item),
      description: answer.item.description ?? null,
      comments: (answer.item.comments ?? []).map(commentOf),
      children: (answer.item.children ?? []).map(itemOf)
    };
  }
}
