import * as vscode from 'vscode';
import * as path from 'node:path';
import type {
  BoardHostMessage,
  BoardItemSummary,
  BoardKind,
  BoardListQuery,
  BoardProviderInfo,
  BoardRepoInfo,
  BoardWebviewMessage
} from '../../shared/board';
import type { CommitItemLink } from '../../shared/protocol';
import { pickRemoteUrl, normalizeRemoteUrl } from '../git/remote';
import { GitHubProvider, parseGitHubRemote, type BoardProvider } from './github';
import { GitLabProvider, type GitLabRepo } from './gitlab';
import { GiteaProvider, type GiteaRepo } from './gitea';
import { GerritProvider, type GerritRepo } from './gerrit';
import { GuestProvider, guestRepoFor } from './guest/provider';
import { TrackerProvider } from './guest/tracker';
import type { BoardContext } from './service';
import type { SourceControlGuestRecord, TrackerGuestRecord } from './guest/store';
import { renderBoardHtml } from '../host/html';
import type { Services } from '../host/services';

const TOKEN_KEY = 'gitStudio.board.githubToken';
const GITLAB_TOKEN_KEY = 'gitStudio.board.gitlabToken';
const GITEA_TOKEN_KEY = 'gitStudio.board.giteaToken';
const GERRIT_TOKEN_KEY = 'gitStudio.board.gerritToken';

interface HostRemote {
  kind: 'gitlab' | 'gitea' | 'gerrit';
  base: string;
  owner: string;
  name: string;
}

function parseHostRemote(raw: string | undefined): HostRemote | undefined {
  const base = normalizeRemoteUrl(raw ?? '');
  if (!base) {
    return undefined;
  }
  let url: URL;
  try {
    url = new URL(base);
  } catch {
    return undefined;
  }
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts.length < 2) {
    return undefined;
  }
  const host = url.hostname.toLowerCase();
  const owner = parts[0];
  const name = parts[1].replace(/\.git$/, '');
  const kind = host.includes('gitlab')
    ? 'gitlab'
    : host.includes('gitea') || host.includes('forgejo') || host.includes('codeberg')
      ? 'gitea'
      : host.includes('gerrit')
        ? 'gerrit'
        : undefined;
  return kind ? { kind, base: `${url.protocol}//${url.host}`, owner, name } : undefined;
}

function linkOf(providerId: string, providerLabel: string, item: BoardItemSummary): CommitItemLink {
  return {
    providerId,
    providerLabel,
    kind: item.kind,
    number: item.number,
    title: item.title,
    state: item.state,
    url: item.url
  };
}

interface BoardRemote {
  name: string;
  fetchUrl?: string;
  pushUrl?: string;
}

export interface BoardRepo {
  root: string;
  name: string;
  remotes: BoardRemote[];
}

interface ShowOptions {
  repo?: BoardRepo;
  uri?: vscode.Uri;
  focus?: { providerId?: string; kind: BoardKind; number: number };
}

async function gitTopLevel(services: Services, start: string): Promise<string | undefined> {
  for (const candidate of [start, path.dirname(start)]) {
    try {
      const root = (await services.runner.run(['rev-parse', '--show-toplevel'], candidate)).trim();
      if (root) {
        return root;
      }
    } catch {
      // Try the parent when the URI is a file rather than a directory.
    }
  }
  return undefined;
}

async function readRemotes(services: Services, root: string): Promise<BoardRemote[]> {
  let output: string;
  try {
    output = await services.runner.run(['remote', '-v'], root);
  } catch {
    return [];
  }
  const remotes = new Map<string, BoardRemote>();
  for (const line of output.split('\n')) {
    const match = /^(\S+)\s+(\S+)\s+\((fetch|push)\)$/.exec(line.trim());
    if (!match) {
      continue;
    }
    const [, name, url, kind] = match;
    const remote = remotes.get(name) ?? { name };
    if (kind === 'fetch') {
      remote.fetchUrl = url;
    } else {
      remote.pushUrl = url;
    }
    remotes.set(name, remote);
  }
  return [...remotes.values()];
}

export async function resolveBoardRepo(services: Services, uri?: vscode.Uri): Promise<BoardRepo | undefined> {
  const handle = uri ? services.repoService.forUri(uri) : undefined;
  if (handle) {
    return { root: handle.root, name: handle.name, remotes: handle.repo.state.remotes };
  }
  const start = uri?.fsPath ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!start) {
    return undefined;
  }
  const root = await gitTopLevel(services, start);
  if (!root) {
    return undefined;
  }
  return { root, name: path.basename(root), remotes: await readRemotes(services, root) };
}

export class BoardPanel {
  private static current: BoardPanel | undefined;
  private readonly disposables: vscode.Disposable[] = [];
  private repo: BoardRepo | undefined;
  private provider: BoardProvider | undefined;
  private repoInfo: BoardRepoInfo | null = null;
  private providers: BoardProviderInfo[] = [];
  private providerId: string | null = null;
  private preferredProviderId: string | null = null;
  private tracker: TrackerProvider | undefined;
  private trackers: BoardProviderInfo[] = [];
  private trackerId: string | null = null;
  private preferredTrackerId: string | null = null;
  private lastTrackerItemId: string | null = null;
  private authenticated = false;
  private ready = false;
  private busy = false;
  private lastKind: BoardKind = 'issue';
  private lastNumber: number | undefined;
  private lastQuery: BoardListQuery | undefined;
  private pendingFocus: { providerId?: string; kind: BoardKind; number: number } | undefined;

  static async show(services: Services, secrets: vscode.SecretStorage, board: BoardContext, options: ShowOptions = {}): Promise<BoardPanel | undefined> {
    const repo = options.repo ?? await resolveBoardRepo(services, options.uri ?? vscode.window.activeTextEditor?.document.uri);
    if (!repo) {
      void vscode.window.showWarningMessage('Git Studio: no Git repository is open.');
      return undefined;
    }

    if (BoardPanel.current) {
      BoardPanel.current.repo = repo;
      BoardPanel.current.pendingFocus = options.focus;
      BoardPanel.current.panel.reveal();
      await BoardPanel.current.refreshState();
      return BoardPanel.current;
    }

    const panel = vscode.window.createWebviewPanel(
      'gitStudio.board',
      `Issues and PRs — ${repo.name}`,
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(services.extensionUri, 'dist', 'board')]
      }
    );
    BoardPanel.current = new BoardPanel(services.extensionUri, secrets, board, repo, panel);
    BoardPanel.current.pendingFocus = options.focus;
    return BoardPanel.current;
  }

  static async refreshCurrent(): Promise<void> {
    await BoardPanel.current?.refreshState();
  }

  static async findCommitItems(
    services: Services,
    secrets: vscode.SecretStorage,
    root: string,
    sha: string
  ): Promise<CommitItemLink[]> {
    const remote = pickRemoteUrl(await readRemotes(services, root));
    if (!remote) {
      return [];
    }

    const github = parseGitHubRemote(remote);
    if (github) {
      const token = await secrets.get(TOKEN_KEY);
      if (!token) {
        return [];
      }
      const provider = new GitHubProvider(token, github);
      provider.repo.root = root;
      const items = provider.findChangeRequestsForCommit ? await provider.findChangeRequestsForCommit(sha) : [];
      return items.map((item) => linkOf('github', 'GitHub', item));
    }

    const host = parseHostRemote(remote);
    if (!host || host.kind === 'gerrit') {
      return [];
    }
    const token = await secrets.get(host.kind === 'gitlab' ? GITLAB_TOKEN_KEY : GITEA_TOKEN_KEY);
    if (!token) {
      return [];
    }
    const provider = host.kind === 'gitlab'
      ? new GitLabProvider(token, host as GitLabRepo)
      : new GiteaProvider(token, host as GiteaRepo);
    provider.repo.root = root;
    const items = provider.findChangeRequestsForCommit ? await provider.findChangeRequestsForCommit(sha) : [];
    return items.map((item) => linkOf(host.kind, host.kind === 'gitlab' ? 'GitLab' : 'Gitea', item));
  }

  static async connectGithub(secrets: vscode.SecretStorage): Promise<void> {
    const token = await vscode.window.showInputBox({
      title: 'GitHub token',
      prompt: 'A fine-grained or classic token with repository read access. Stored in VS Code SecretStorage.',
      password: true,
      ignoreFocusOut: true
    });
    if (!token) {
      return;
    }

    const response = await fetch('https://api.github.com/user', {
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${token}`,
        'x-github-api-version': '2022-11-28'
      }
    });
    if (!response.ok) {
      void vscode.window.showErrorMessage(`Git Studio: GitHub rejected the token (${response.status}).`);
      return;
    }
    await secrets.store(TOKEN_KEY, token);
    await BoardPanel.current?.refreshState();
    await BoardPanel.current?.reload();
  }

  private constructor(
    extensionUri: vscode.Uri,
    private readonly secrets: vscode.SecretStorage,
    private readonly board: BoardContext,
    repo: BoardRepo,
    private readonly panel: vscode.WebviewPanel
  ) {
    this.repo = repo;
    panel.webview.html = renderBoardHtml(panel.webview, extensionUri);
    panel.webview.onDidReceiveMessage((message: BoardWebviewMessage) => {
      void this.onMessage(message);
    }, undefined, this.disposables);
    panel.onDidDispose(() => this.dispose(), undefined, this.disposables);
    void this.refreshState();
  }

  private async onMessage(message: BoardWebviewMessage): Promise<void> {
    switch (message.type) {
      case 'ready':
        this.ready = true;
        await this.refreshState();
        return;
      case 'refresh':
        await this.refreshState();
        await this.reload();
        return;
      case 'list':
        await this.list(message.requestId, message.query);
        return;
      case 'detail':
        await this.detail(message.requestId, message.kind, message.number);
        return;
      case 'comment':
        await this.mutate('Commenting', () => this.requireProvider().comment(message.kind, message.number, message.body));
        return;
      case 'setState':
        await this.mutate(message.state === 'closed' ? 'Closing' : 'Reopening', () =>
          this.requireProvider().setState(message.kind, message.number, message.state, message.reason)
        );
        return;
      case 'markReady':
        await this.mutate('Marking ready', () => {
          const provider = this.requireProvider();
          if (!provider.markReady) throw new Error('This provider cannot mark a change request ready.');
          return provider.markReady(message.number);
        });
        return;
      case 'checks':
        await this.checks(message.requestId, message.number);
        return;
      case 'reviewReply':
        await this.mutate('Replying', () => {
          const provider = this.requireProvider();
          if (!provider.replyReviewThread) throw new Error('This provider cannot reply to review threads.');
          return provider.replyReviewThread(message.threadId, message.body);
        });
        return;
      case 'merge':
        await this.mutate('Merging', () => this.requireProvider().merge(message.number, message.method));
        return;
      case 'listLabels':
        await this.listLabels(message.requestId);
        return;
      case 'listReviewers':
        await this.listReviewers(message.requestId);
        return;
      case 'setLabels':
        await this.mutate('Saving labels', () => {
          const provider = this.requireProvider();
          if (!provider.setLabels) throw new Error('This provider cannot change labels.');
          return provider.setLabels(message.number, message.names);
        });
        return;
      case 'setReviewers':
        await this.mutate('Saving reviewers', () => {
          const provider = this.requireProvider();
          if (!provider.setReviewers) throw new Error('This provider cannot change reviewers.');
          return provider.setReviewers(message.number, message.names);
        });
        return;
      case 'review':
        if (message.votes) {
          await this.mutate('Voting', () => {
            const provider = this.requireProvider();
            if (!provider.reviewVotes) throw new Error('This provider cannot vote on change requests.');
            return provider.reviewVotes(message.number, message.votes!, message.body);
          });
          return;
        }
        await this.mutate(message.verdict === 'approve' ? 'Approving' : 'Requesting changes', () => {
          const provider = this.requireProvider();
          if (!provider.review || !message.verdict) throw new Error('This provider cannot review change requests.');
          return provider.review(message.number, message.verdict, message.body);
        });
        return;
      case 'openExternal':
        await vscode.env.openExternal(vscode.Uri.parse(message.url));
        return;
      case 'copy':
        await vscode.env.clipboard.writeText(message.text);
        return;
      case 'connectProvider':
        await this.connectProvider(message.providerId);
        return;
      case 'selectProvider':
        this.preferredProviderId = message.providerId;
        await this.refreshState();
        await this.reload();
        return;
      case 'selectTracker':
        this.preferredTrackerId = message.trackerId;
        await this.refreshState();
        return;
      case 'trackerList':
        await this.trackerList(message.requestId, message.state, message.cursor);
        return;
      case 'trackerDetail':
        await this.trackerDetail(message.requestId, message.id);
        return;
      case 'trackerStates':
        await this.trackerStates(message.requestId, message.containerId);
        return;
      case 'trackerSetState':
        await this.trackerSetState(message.itemId, message.stateId);
        return;
      case 'trackerComment':
        await this.trackerComment(message.identifier, message.body);
        return;
      case 'connectGithub':
        await this.connectGithub();
        return;
      case 'openSettings':
        await vscode.commands.executeCommand('workbench.action.openSettings', 'gitStudio.board');
        return;
    }
  }

  private requireProvider(): BoardProvider {
    if (!this.provider) {
      throw new Error('No board provider is available for this repository.');
    }
    return this.provider;
  }

  private remoteUrl(): string | undefined {
    return pickRemoteUrl(this.repo?.remotes ?? []);
  }

  private async connectProvider(providerId: string): Promise<void> {
    if (providerId === 'github') {
      await this.connectGithub();
      return;
    }
    if (providerId === 'gitlab' || providerId === 'gitea' || providerId === 'gerrit') {
      const host = parseHostRemote(this.remoteUrl());
      if (!host) {
        return;
      }
      const label = providerId === 'gitlab' ? 'GitLab' : providerId === 'gitea' ? 'Gitea' : 'Gerrit';
      const token = await vscode.window.showInputBox({
        title: `${label} token`,
        prompt: `Token for ${host.base}. Stored in VS Code SecretStorage.`,
        password: true,
        ignoreFocusOut: true
      });
      if (!token) {
        return;
      }
      await this.secrets.store(
        providerId === 'gitlab' ? GITLAB_TOKEN_KEY : providerId === 'gitea' ? GITEA_TOKEN_KEY : GERRIT_TOKEN_KEY,
        token
      );
      await this.refreshState();
      await this.reload();
      return;
    }
    const record = this.board.guests.list().find((entry) => entry.role === 'source-control' && `ext-${entry.id}` === providerId);
    if (!record || record.role !== 'source-control') {
      void vscode.window.showWarningMessage('Git Studio: that integration is no longer installed.');
      return;
    }
    const token = await vscode.window.showInputBox({
      title: `${record.descriptor.label} token`,
      prompt: `Token for ${record.instance}. Stored in VS Code SecretStorage.`,
      password: true,
      ignoreFocusOut: true
    });
    if (!token) {
      return;
    }
    let login: string | undefined;
    if (record.descriptor.token.username) {
      login = await vscode.window.showInputBox({
        title: `${record.descriptor.label} username`,
        prompt: 'The username sent with the token (HTTP Basic).',
        ignoreFocusOut: true
      });
      if (!login) {
        return;
      }
    }
    try {
      await this.board.guestService.connect(record, token, login);
      await this.refreshState();
      await this.reload();
    } catch (error) {
      void vscode.window.showErrorMessage(`Git Studio: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async connectGithub(): Promise<void> {
    await BoardPanel.connectGithub(this.secrets);
  }

  private async buildProvider(): Promise<void> {
    this.provider = undefined;
    this.repoInfo = null;
    this.providers = [];
    this.providerId = null;
    this.authenticated = false;

    const remote = this.remoteUrl();
    const github = parseGitHubRemote(remote);
    const host = github ? undefined : parseHostRemote(remote);
    const guestMatches = this.board.guests.list()
      .filter((record) => record.role === 'source-control')
      .map((record) => ({ record, repo: guestRepoFor(record, remote) }))
      .filter((entry): entry is { record: SourceControlGuestRecord; repo: BoardRepoInfo } => Boolean(entry.repo));

    if (github) {
      this.providers.push({ id: 'github', label: 'GitHub', kinds: ['issue', 'pull', 'discussion'], builtin: true });
    } else if (host?.kind === 'gitlab') {
      this.providers.push({ id: 'gitlab', label: 'GitLab', kinds: ['issue', 'pull'], builtin: true });
    } else if (host?.kind === 'gitea') {
      this.providers.push({ id: 'gitea', label: 'Gitea', kinds: ['issue', 'pull'], builtin: true });
    } else if (host?.kind === 'gerrit') {
      this.providers.push({ id: 'gerrit', label: 'Gerrit', kinds: ['pull'], builtin: true });
    }
    for (const { record, repo } of guestMatches) {
      this.providers.push({
        id: `ext-${record.id}`,
        label: record.descriptor.label,
        kinds: repo.kinds,
        builtin: false,
        packageRoot: record.packageRoot
      });
    }

    const chosenGuest = guestMatches.find((entry) => `ext-${entry.record.id}` === this.preferredProviderId)
      ?? (this.preferredProviderId && this.preferredProviderId !== 'github' && this.preferredProviderId !== 'gitlab' && this.preferredProviderId !== 'gitea'
        ? guestMatches[0]
        : guestMatches[0]);
    const preferGuest = Boolean(this.preferredProviderId?.startsWith('ext-') && chosenGuest)
      || (guestMatches.length > 0 && !this.providers.some((entry) => entry.id === this.preferredProviderId));
    if (preferGuest && chosenGuest) {
      const { record, repo } = chosenGuest;
      this.providerId = `ext-${record.id}`;
      this.preferredProviderId = this.providerId;
      this.repoInfo = { ...repo, root: this.repo?.root ?? '' };
      const credential = await this.board.guestService.credential(record);
      if (credential) {
        this.provider = new GuestProvider(record, this.board.guestService, this.repoInfo);
        this.authenticated = true;
      }
      return;
    }

    if (github) {
      this.providerId = 'github';
      this.preferredProviderId = 'github';
      const token = await this.secrets.get(TOKEN_KEY);
      if (!token) {
        this.repoInfo = {
          root: this.repo?.root ?? '',
          owner: github.owner,
          name: github.name,
          url: `https://github.com/${github.owner}/${github.name}`,
          providerId: 'github',
          providerLabel: 'GitHub',
          kinds: ['issue', 'pull', 'discussion']
        };
        return;
      }
      const provider = new GitHubProvider(token, github);
      provider.repo.root = this.repo?.root ?? '';
      this.provider = provider;
      this.repoInfo = provider.repo;
      this.authenticated = true;
      return;
    }

    if (host?.kind === 'gitlab' || host?.kind === 'gitea' || host?.kind === 'gerrit') {
      const id = host.kind;
      this.providerId = id;
      this.preferredProviderId = id;
      const token = await this.secrets.get(
        id === 'gitlab' ? GITLAB_TOKEN_KEY : id === 'gitea' ? GITEA_TOKEN_KEY : GERRIT_TOKEN_KEY
      );
      const label = id === 'gitlab' ? 'GitLab' : id === 'gitea' ? 'Gitea' : 'Gerrit';
      this.repoInfo = {
        root: this.repo?.root ?? '',
        owner: host.owner,
        name: host.name,
        url: `${host.base}/${host.owner}/${host.name}`,
        providerId: id,
        providerLabel: label,
        kinds: id === 'gerrit' ? ['pull'] : ['issue', 'pull']
      };
      if (!token) {
        return;
      }
      const provider = id === 'gitlab'
        ? new GitLabProvider(token, host as GitLabRepo)
        : id === 'gitea'
          ? new GiteaProvider(token, host as GiteaRepo)
          : new GerritProvider(token, host as GerritRepo);
      provider.repo.root = this.repo?.root ?? '';
      this.provider = provider;
      this.repoInfo = provider.repo;
      this.authenticated = true;
    }
  }

  private async refreshState(): Promise<void> {
    if (this.pendingFocus?.providerId && this.pendingFocus.providerId !== this.providerId) {
      this.preferredProviderId = this.pendingFocus.providerId;
    }
    await this.buildProvider();
    await this.buildTracker();
    this.panel.title = `Issues and PRs — ${this.repo?.name ?? 'repository'}`;
    this.post({
      type: 'state',
      repo: this.repoInfo,
      providers: this.providers,
      providerId: this.providerId,
      authenticated: this.authenticated,
      trackers: this.trackers,
      trackerId: this.trackerId
    });
    if (this.pendingFocus && this.ready) {
      this.post({ type: 'focusItem', ...this.pendingFocus });
      this.pendingFocus = undefined;
    }
  }

  private async buildTracker(): Promise<void> {
    this.tracker = undefined;
    this.trackers = [];
    this.trackerId = null;
    const records = this.board.guests.list().filter((record): record is TrackerGuestRecord => record.role === 'tracker');
    for (const record of records) {
      this.trackers.push({
        id: `ext-${record.id}`,
        label: record.tracker.label,
        kinds: [],
        builtin: false,
        packageRoot: record.packageRoot
      });
    }
    if (records.length === 0) {
      return;
    }
    const record = records.find((entry) => `ext-${entry.id}` === this.preferredTrackerId) ?? records[0];
    this.trackerId = `ext-${record.id}`;
    this.preferredTrackerId = this.trackerId;
    const credential = await this.board.guestService.credential(record);
    if (credential) {
      this.tracker = new TrackerProvider(record, this.board.guestService);
    }
  }

  private async trackerList(requestId: number, state: string, cursor?: string | null): Promise<void> {
    if (!this.tracker) {
      this.post({ type: 'trackerList', requestId, result: { items: [], cursor: null, hasMore: false } });
      return;
    }
    try {
      const result = await this.tracker.list(state, cursor);
      this.post({ type: 'trackerList', requestId, result });
    } catch (error) {
      this.post({ type: 'error', requestId, message: error instanceof Error ? error.message : String(error) });
      this.post({ type: 'trackerList', requestId, result: { items: [], cursor: null, hasMore: false } });
    }
  }

  private async trackerDetail(requestId: number, id: string): Promise<void> {
    this.lastTrackerItemId = id;
    if (!this.tracker) {
      this.post({ type: 'trackerDetail', requestId, detail: null });
      return;
    }
    try {
      const detail = await this.tracker.detail(id);
      this.post({ type: 'trackerDetail', requestId, detail });
    } catch (error) {
      this.post({ type: 'trackerDetail', requestId, detail: null, error: error instanceof Error ? error.message : String(error) });
    }
  }

  private async reload(): Promise<void> {
    if (!this.provider || !this.lastQuery) {
      return;
    }
    await this.list(0, this.lastQuery);
    if (this.lastNumber !== undefined) {
      await this.detail(0, this.lastKind, this.lastNumber);
    }
  }

  private async list(requestId: number, query: BoardListQuery): Promise<void> {
    this.lastQuery = query;
    this.lastKind = query.kind;
    try {
      const result = await this.requireProvider().list(query);
      this.post({ type: 'list', requestId, result });
    } catch (error) {
      this.post({ type: 'error', requestId, message: error instanceof Error ? error.message : String(error) });
    }
  }

  private async detail(requestId: number, kind: BoardKind, number: number): Promise<void> {
    this.lastKind = kind;
    this.lastNumber = number;
    try {
      const detail = await this.requireProvider().detail(kind, number);
      this.post({ type: 'detail', requestId, detail });
    } catch (error) {
      this.post({ type: 'detail', requestId, detail: null, error: error instanceof Error ? error.message : String(error) });
    }
  }

  private async listLabels(requestId: number): Promise<void> {
    try {
      const provider = this.requireProvider();
      const labels = provider.listLabels ? await provider.listLabels() : [];
      this.post({ type: 'labels', requestId, labels });
    } catch (error) {
      this.post({ type: 'error', requestId, message: error instanceof Error ? error.message : String(error) });
    }
  }

  private async listReviewers(requestId: number): Promise<void> {
    try {
      const provider = this.requireProvider();
      const reviewers = provider.listReviewerCandidates ? await provider.listReviewerCandidates() : [];
      this.post({ type: 'reviewers', requestId, reviewers });
    } catch (error) {
      this.post({ type: 'error', requestId, message: error instanceof Error ? error.message : String(error) });
    }
  }

  private async checks(requestId: number, number: number): Promise<void> {
    try {
      const provider = this.requireProvider();
      const checks = provider.checks ? await provider.checks(number) : [];
      this.post({ type: 'checks', requestId, checks });
    } catch (error) {
      this.post({ type: 'checks', requestId, checks: [], error: error instanceof Error ? error.message : String(error) });
    }
  }

  private async trackerStates(requestId: number, containerId: string): Promise<void> {
    if (!this.tracker) {
      this.post({ type: 'trackerStates', requestId, states: [] });
      return;
    }
    try {
      const states = await this.tracker.states(containerId);
      this.post({ type: 'trackerStates', requestId, states });
    } catch (error) {
      this.post({ type: 'trackerStates', requestId, states: [], error: error instanceof Error ? error.message : String(error) });
    }
  }

  private async trackerComment(identifier: string, body: string): Promise<void> {
    if (!this.tracker) {
      return;
    }
    if (this.busy) {
      return;
    }
    this.busy = true;
    this.post({ type: 'busy', busy: true, operation: 'Commenting' });
    try {
      await this.tracker.comment(identifier, body);
      this.post({ type: 'busy', busy: false });
      if (this.lastTrackerItemId) {
        const detail = await this.tracker.detail(this.lastTrackerItemId);
        this.post({ type: 'trackerDetail', requestId: 0, detail });
      }
    } catch (error) {
      this.post({ type: 'busy', busy: false });
      this.post({ type: 'error', message: error instanceof Error ? error.message : String(error) });
    }
  }

  private async trackerSetState(itemId: string, stateId: string): Promise<void> {
    if (!this.tracker) {
      return;
    }
    if (this.busy) {
      return;
    }
    this.busy = true;
    this.post({ type: 'busy', busy: true, operation: 'Updating state' });
    try {
      await this.tracker.setState(itemId, stateId);
      this.post({ type: 'busy', busy: false });
      const detail = await this.tracker.detail(itemId);
      this.post({ type: 'trackerDetail', requestId: 0, detail });
    } catch (error) {
      this.post({ type: 'busy', busy: false });
      this.post({ type: 'error', message: error instanceof Error ? error.message : String(error) });
    }
  }

  private async mutate(label: string, action: () => Promise<void>): Promise<void> {
    if (this.busy) {
      return;
    }
    this.busy = true;
    this.post({ type: 'busy', busy: true, operation: label });
    try {
      await action();
      await this.reload();
    } catch (error) {
      this.post({ type: 'error', message: error instanceof Error ? error.message : String(error) });
    } finally {
      this.busy = false;
      this.post({ type: 'busy', busy: false });
    }
  }

  private post(message: BoardHostMessage): void {
    if (this.ready) {
      void this.panel.webview.postMessage(message);
    }
  }

  private dispose(): void {
    BoardPanel.current = undefined;
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
  }
}
