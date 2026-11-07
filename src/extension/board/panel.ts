import * as vscode from 'vscode';
import * as path from 'node:path';
import type {
  BoardHostMessage,
  BoardKind,
  BoardListQuery,
  BoardProviderInfo,
  BoardRepoInfo,
  BoardWebviewMessage
} from '../../shared/board';
import { pickRemoteUrl } from '../git/remote';
import { GitHubProvider, parseGitHubRemote, type BoardProvider, type GitHubRepo } from './github';
import { GuestProvider, guestRepoFor } from './guest/provider';
import type { BoardContext } from './service';
import type { GuestRecord } from './guest/store';
import { renderBoardHtml } from '../host/html';
import type { Services } from '../host/services';

const TOKEN_KEY = 'gitStudio.board.githubToken';

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
  private authenticated = false;
  private ready = false;
  private busy = false;
  private lastKind: BoardKind = 'issue';
  private lastNumber: number | undefined;
  private lastQuery: BoardListQuery | undefined;

  static async show(services: Services, secrets: vscode.SecretStorage, board: BoardContext, options: ShowOptions = {}): Promise<BoardPanel | undefined> {
    const repo = options.repo ?? await resolveBoardRepo(services, options.uri ?? vscode.window.activeTextEditor?.document.uri);
    if (!repo) {
      void vscode.window.showWarningMessage('Git Studio: no Git repository is open.');
      return undefined;
    }

    if (BoardPanel.current) {
      BoardPanel.current.repo = repo;
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
    return BoardPanel.current;
  }

  static async refreshCurrent(): Promise<void> {
    await BoardPanel.current?.refreshState();
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
          this.requireProvider().setState(message.kind, message.number, message.state)
        );
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
        await this.mutate(message.verdict === 'approve' ? 'Approving' : 'Requesting changes', () => {
          const provider = this.requireProvider();
          if (!provider.review) throw new Error('This provider cannot review change requests.');
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
    const record = this.board.guests.list().find((entry) => `ext-${entry.id}` === providerId);
    if (!record) {
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
    this.providers = [{ id: 'github', label: 'GitHub', kinds: ['issue', 'pull', 'discussion'], builtin: true }];
    this.providerId = null;
    this.authenticated = false;

    const remote = this.remoteUrl();
    const guestMatches = this.board.guests.list()
      .map((record) => ({ record, repo: guestRepoFor(record, remote) }))
      .filter((entry): entry is { record: GuestRecord; repo: NonNullable<ReturnType<typeof guestRepoFor>> } => Boolean(entry.repo));
    for (const { record, repo } of guestMatches) {
      this.providers.push({
        id: `ext-${record.id}`,
        label: record.descriptor.label,
        kinds: repo.kinds,
        builtin: false,
        packageRoot: record.packageRoot
      });
    }

    if (guestMatches.length > 0 && this.preferredProviderId !== 'github') {
      const preferred = guestMatches.find((entry) => `ext-${entry.record.id}` === this.preferredProviderId);
      const { record, repo } = preferred ?? guestMatches[0];
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

    const github: GitHubRepo | undefined = parseGitHubRemote(remote);
    if (!github) {
      return;
    }

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
      this.providerId = 'github';
      return;
    }

    const provider = new GitHubProvider(token, github);
    provider.repo.root = this.repo?.root ?? '';
    this.provider = provider;
    this.repoInfo = provider.repo;
    this.providerId = provider.info.id;
    this.authenticated = true;
  }

  private async refreshState(): Promise<void> {
    await this.buildProvider();
    this.panel.title = `Issues and PRs — ${this.repo?.name ?? 'repository'}`;
    this.post({
      type: 'state',
      repo: this.repoInfo,
      providers: this.providers,
      providerId: this.providerId,
      authenticated: this.authenticated
    });
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
