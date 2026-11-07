import * as vscode from 'vscode';
import * as path from 'node:path';
import type {
  CommitDetail,
  CommitRow,
  FileChange,
  Filters,
  GraphRow,
  HostMessage,
  RefInfo,
  WebviewMessage
} from '../../shared/protocol';
import { loadCommitDetail } from '../git/commit';
import { loadDiffFiles } from '../git/diff';
import { loadCommits, type LogQuery } from '../git/log';
import { loadRefs } from '../git/refs';
import { layoutGraph } from '../graph/layout';
import { CommitActionRunner } from './actions';
import { renderHtml } from './html';
import type { RepoHandle } from './repoService';
import type { Services } from './services';
import { emptyUri, gitUri as toGitUri } from './uris';

const PAGE_SIZE = 500;

interface ShowOptions {
  repo?: RepoHandle;
  fileUri?: vscode.Uri;
  focus?: string;
}

function emptyFilters(repo: RepoHandle): Filters {
  const configuration = vscode.workspace.getConfiguration('gitStudio');
  const allRefs = configuration.get<string>('history.defaultRefs', 'all') !== 'current';
  const branch = repo.repo.state.HEAD?.name;

  return {
    refs: allRefs || !branch ? [] : [`refs/heads/${branch}`],
    path: '',
    author: '',
    message: '',
    regex: false,
    caseSensitive: false,
    firstParent: false,
    noMerges: false,
    since: '',
    until: '',
    order: configuration.get<'date' | 'topo'>('history.order', 'date')
  };
}

function shortHash(hash: string): string {
  return hash.slice(0, 7);
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class HistoryPanel {
  private static current: HistoryPanel | undefined;

  private readonly disposables: vscode.Disposable[] = [];
  private repo: RepoHandle;
  private filters: Filters;
  private filePath: string | undefined;
  private refs: RefInfo[] = [];
  private rows: CommitRow[] = [];
  private graph: GraphRow[] = [];
  private hasMore = true;
  private refSignature = '';
  private lastRefsAt = 0;
  private token = 0;
  private abort: AbortController | undefined;
  private ready = false;
  private pendingFocus: string | undefined;
  private details = new Map<string, CommitDetail>();
  private readonly parentIndex = new Map<string, number>();
  private readonly actions: CommitActionRunner;
  private repoSubscriptions: vscode.Disposable[] = [];
  private repoRefreshTimer: NodeJS.Timeout | undefined;
  private lastRefreshAt = 0;

  static async show(services: Services, options: ShowOptions = {}): Promise<HistoryPanel | undefined> {
    if (HistoryPanel.current && !options.repo) {
      options = { ...options, repo: HistoryPanel.current.repo };
    }
    const handle = options.repo ?? await services.repoService.pick(options.fileUri ?? vscode.window.activeTextEditor?.document.uri);
    if (!handle) {
      void vscode.window.showWarningMessage('Git Studio: no Git repository found in this workspace.');
      return undefined;
    }

    if (HistoryPanel.current) {
      HistoryPanel.current.reuse(handle, options);
      return HistoryPanel.current;
    }

    const panel = vscode.window.createWebviewPanel(
      'gitStudio.history',
      'Git History',
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: false,
        localResourceRoots: [vscode.Uri.joinPath(services.extensionUri, 'dist', 'webview')]
      }
    );

    HistoryPanel.current = new HistoryPanel(services, panel, handle, options);
    return HistoryPanel.current;
  }

  private constructor(
    private readonly services: Services,
    private readonly panel: vscode.WebviewPanel,
    repo: RepoHandle,
    options: ShowOptions
  ) {
    this.repo = repo;
    this.filters = emptyFilters(repo);
    this.filePath = options.fileUri ? services.repoService.relativePath(repo, options.fileUri) : undefined;
    if (this.filePath) {
      this.filters.path = this.filePath;
    }
    this.pendingFocus = options.focus;
    this.actions = new CommitActionRunner(services, () => this.repo, () => this.refresh());
    this.bindRepo();

    this.panel.webview.html = renderHtml(panel.webview, services.extensionUri);
    if (this.filePath) {
      panel.title = `History: ${path.basename(this.filePath)}`;
    }
    this.disposables.push(
      panel.webview.onDidReceiveMessage((message: WebviewMessage) => void this.onMessage(message)),
      panel.onDidChangeViewState(() => {
        if (!panel.visible) {
          this.ready = false;
        }
      }),
      panel.onDidDispose(() => this.dispose())
    );
  }

  private reuse(handle: RepoHandle, options: ShowOptions): void {
    const repoChanged = handle.root !== this.repo.root;
    if (repoChanged) {
      this.repo = handle;
      this.bindRepo();
      this.filters = emptyFilters(handle);
      this.filePath = undefined;
      this.refs = [];
      this.rows = [];
      this.graph = [];
      this.hasMore = true;
      this.refSignature = '';
      this.details.clear();
      this.parentIndex.clear();
    }

    if (options.fileUri) {
      const relative = this.services.repoService.relativePath(this.repo, options.fileUri);
      if (relative) {
        this.filePath = relative;
        this.filters = {
          ...emptyFilters(this.repo),
          path: relative
        };
        this.refSignature = '';
        this.panel.title = `History: ${path.basename(relative)}`;
      }
    }

    if (options.focus) {
      if (this.ready) {
        this.focus(options.focus);
      } else {
        this.pendingFocus = options.focus;
      }
    }

    this.panel.reveal(vscode.ViewColumn.Active);

    if (this.ready && (repoChanged || options.fileUri)) {
      void this.sendInit();
    }
  }

  private async onMessage(message: WebviewMessage): Promise<void> {
    try {
      switch (message.type) {
        case 'ready':
          this.ready = true;
          await this.sendInit();
          if (this.pendingFocus) {
            const hash = this.pendingFocus;
            this.pendingFocus = undefined;
            this.focus(hash);
          }
          break;
        case 'query':
          await this.query(message);
          break;
        case 'selectCommit':
          await this.select(message.hash, message.parentIndex ?? 0);
          break;
        case 'openFileDiff':
          await this.openFileDiff(message.hash, message.path, message.oldPath, message.status);
          break;
        case 'openCommitChanges':
          await this.openCommitChanges(message.hash);
          break;
        case 'commitActions':
          await this.actions.show(message.hash, await this.detailFor(message.hash));
          break;
        case 'compare':
          await this.compare(message.a, message.b);
          break;
        case 'openFileHistory':
          this.openFileHistory(message.path);
          break;
        case 'openFileAtRevision':
          await this.openFileAtRevision(message.hash, message.path);
          break;
        case 'pickerRefs':
          await this.pickRefs();
          break;
        case 'pickerRepo':
          await this.pickRepo();
          break;
        case 'refresh':
          await this.refresh();
          break;
        case 'copy':
          await vscode.env.clipboard.writeText(message.text);
          break;
        case 'openSettings':
          await vscode.commands.executeCommand('workbench.action.openSettings', 'gitStudio');
          break;
      }
    } catch (error) {
      this.services.output.error(`[webview:${message.type}] ${errorText(error)}`);
      this.post({ type: 'error', message: errorText(error) });
    }
  }

  private async sendInit(): Promise<void> {
    try {
      this.refs = await loadRefs(this.services.runner, this.repo.root);
      this.lastRefsAt = Date.now();
    } catch (error) {
      this.services.output.warn(`failed to load refs: ${errorText(error)}`);
    }

    const pageSize = vscode.workspace.getConfiguration('gitStudio').get<number>('history.pageSize', PAGE_SIZE);
    this.post({
      type: 'init',
      state: {
        repo: this.services.repoService.summary(this.repo),
        repos: this.services.repoService.list().map((handle) => this.services.repoService.summary(handle)),
        refs: this.refs,
        filters: this.filters,
        filePath: this.filePath ?? null,
        pageSize: Math.max(50, Math.min(5000, pageSize))
      }
    });
  }

  private async query(message: Extract<WebviewMessage, { type: 'query' }>): Promise<void> {
    if (!message.append) {
      this.abort?.abort();
      this.abort = new AbortController();
      this.token += 1;
      this.rows = [];
      this.graph = [];
      this.hasMore = true;
      this.filters = { ...message.filters };
      if (this.filePath && this.filters.path !== this.filePath) {
        this.filePath = undefined;
      }
    }

    const token = this.token;
    const signal = this.abort?.signal;
    const skip = Math.max(0, message.skip);
    const limit = Math.max(1, Math.min(5000, message.limit));

    this.post({ type: 'busy', busy: true });
    try {
      const stale = await this.checkStale(signal);
      const query: LogQuery = {
        refs: this.filters.refs,
        path: this.filters.path || undefined,
        follow: Boolean(this.filters.path && this.filePath),
        author: this.filters.author || undefined,
        message: this.filters.message || undefined,
        regex: this.filters.regex,
        caseSensitive: this.filters.caseSensitive,
        firstParent: this.filters.firstParent,
        noMerges: this.filters.noMerges,
        since: this.filters.since || undefined,
        until: this.filters.until || undefined,
        order: this.filters.order,
        skip,
        limit
      };

      const result = await loadCommits(this.services.runner, this.repo.root, query, signal);
      if (token !== this.token) {
        return;
      }

      const incoming = message.append
        ? result.rows.filter((row) => !this.rows.some((existing) => existing.hash === row.hash))
        : result.rows;

      this.rows = message.append ? [...this.rows, ...incoming] : incoming;
      this.graph = layoutGraph(this.rows);
      this.hasMore = result.hasMore;

      this.post({
        type: 'commits',
        requestId: message.requestId,
        append: message.append,
        rows: incoming,
        graph: this.graph,
        hasMore: this.hasMore,
        stale
      });
    } catch (error) {
      if (isAbort(error) || token !== this.token) {
        return;
      }
      this.post({ type: 'error', requestId: message.requestId, message: errorText(error) });
    } finally {
      if (token === this.token) {
        this.post({ type: 'busy', busy: false });
      }
    }
  }

  private async checkStale(signal?: AbortSignal): Promise<boolean> {
    if (Date.now() - this.lastRefsAt < 5000) {
      return false;
    }
    try {
      const refs = await loadRefs(this.services.runner, this.repo.root, signal);
      this.refs = refs;
      this.lastRefsAt = Date.now();
      const signature = refs
        .map((ref) => `${ref.name}:${ref.oid}`)
        .sort()
        .join('|');
      if (!this.refSignature) {
        this.refSignature = signature;
        return false;
      }
      return signature !== this.refSignature;
    } catch {
      return false;
    }
  }

  private async select(hash: string, parentIndex = 0): Promise<void> {
    this.parentIndex.set(hash, parentIndex);
    const key = `${hash}:${parentIndex}`;
    const cached = this.details.get(key);
    if (cached) {
      this.post({ type: 'detail', hash, detail: cached });
      return;
    }

    this.post({ type: 'detail', hash, detail: null });
    try {
      const detail = await loadCommitDetail(this.services.runner, this.repo.root, hash, parentIndex);
      this.details.set(key, detail);
      if (this.details.size > 50) {
        const oldest = this.details.keys().next().value;
        if (oldest) {
          this.details.delete(oldest);
        }
      }
      this.post({ type: 'detail', hash, detail });
    } catch (error) {
      this.post({ type: 'detail', hash, detail: null, error: errorText(error) });
    }
  }

  private async detailFor(hash: string): Promise<CommitDetail | undefined> {
    const parentIndex = this.parentIndex.get(hash) ?? 0;
    const key = `${hash}:${parentIndex}`;
    const cached = this.details.get(key);
    if (cached) {
      return cached;
    }
    try {
      const detail = await loadCommitDetail(this.services.runner, this.repo.root, hash, parentIndex);
      this.details.set(key, detail);
      return detail;
    } catch (error) {
      this.services.output.error(`load commit ${hash} failed: ${errorText(error)}`);
      return undefined;
    }
  }

  private gitUri(filePath: string, ref: string): vscode.Uri {
    return toGitUri(this.services, this.repo, filePath, ref);
  }

  private fileUris(file: FileChange, hash: string, parent: string | undefined): [vscode.Uri, vscode.Uri, vscode.Uri] {
    const oldPath = file.oldPath ?? file.path;
    const left = file.status === 'A' || !parent
      ? emptyUri(oldPath)
      : this.gitUri(oldPath, parent);
    const right = file.status === 'D'
      ? emptyUri(file.path)
      : this.gitUri(file.path, hash);
    return [vscode.Uri.joinPath(this.repo.repo.rootUri, file.path), left, right];
  }

  private async openFileDiff(hash: string, filePath: string, oldPath: string | undefined, status: FileChange['status']): Promise<void> {
    const detail = await this.detailFor(hash);
    if (!detail) {
      return;
    }
    const file: FileChange = {
      path: filePath,
      oldPath,
      status,
      additions: 0,
      deletions: 0,
      binary: false
    };
    const [, left, right] = this.fileUris(file, hash, detail.parents[detail.parentIndex]);
    await vscode.commands.executeCommand(
      'vscode.diff',
      left,
      right,
      `${path.basename(filePath)} (${shortHash(hash)})`
    );
  }

  private async openCommitChanges(hash: string): Promise<void> {
    const detail = await this.detailFor(hash);
    if (!detail || detail.files.length === 0) {
      void vscode.window.showInformationMessage(`Git Studio: ${shortHash(hash)} has no changed files.`);
      return;
    }

    const entries = detail.files.map((file) => this.fileUris(file, hash, detail.parents[detail.parentIndex]));
    try {
      await vscode.commands.executeCommand('vscode.changes', `${shortHash(hash)} · ${detail.message.split('\n')[0]}`, entries);
    } catch (error) {
      this.services.output.warn(`vscode.changes failed, opening first file: ${errorText(error)}`);
      await vscode.commands.executeCommand('vscode.diff', entries[0][1], entries[0][2], `${shortHash(hash)} · ${detail.files[0].path}`);
    }
  }

  private async compare(a: string, b: string): Promise<void> {
    if (!a || !b || a === b) {
      return;
    }
    const files = await loadDiffFiles(this.services.runner, this.repo.root, a, b);
    if (files.length === 0) {
      void vscode.window.showInformationMessage(`Git Studio: ${shortHash(a)} and ${shortHash(b)} have no differences.`);
      return;
    }

    const entries = files.map((file): [vscode.Uri, vscode.Uri, vscode.Uri] => {
      const uri = vscode.Uri.joinPath(this.repo.repo.rootUri, file.path);
      const oldPath = file.oldPath ?? file.path;
      const left = file.status === 'A' ? emptyUri(oldPath) : this.gitUri(oldPath, a);
      const right = file.status === 'D' ? emptyUri(file.path) : this.gitUri(file.path, b);
      return [uri, left, right];
    });

    try {
      await vscode.commands.executeCommand('vscode.changes', `${shortHash(a)} ↔ ${shortHash(b)}`, entries);
    } catch (error) {
      this.services.output.warn(`vscode.changes failed: ${errorText(error)}`);
    }
  }

  private openFileHistory(filePath: string): void {
    this.filePath = filePath;
    this.filters = {
      ...emptyFilters(this.repo),
      path: filePath
    };
    this.refSignature = '';
    this.rows = [];
    this.graph = [];
    this.hasMore = true;
    this.panel.title = `History: ${path.basename(filePath)}`;
    void this.sendInit();
    this.post({ type: 'filters', filters: this.filters });
  }

  private async openFileAtRevision(hash: string, filePath: string): Promise<void> {
    await vscode.commands.executeCommand('vscode.open', this.gitUri(filePath, hash), { preview: true });
  }

  private async pickRefs(): Promise<void> {
    const items: (vscode.QuickPickItem & { value: string })[] = [
      { label: '$(globe) All refs', value: '', description: 'No ref filter' },
      ...this.refs.map((ref) => ({
        label: ref.shortName,
        description: ref.type === 'tag' ? 'tag' : ref.type === 'remote' ? 'remote' : 'branch',
        detail: ref.oid.slice(0, 8),
        picked: this.filters.refs.includes(ref.name),
        value: ref.name
      }))
    ];

    const picked = await vscode.window.showQuickPick(items, {
      canPickMany: true,
      placeHolder: 'Filter by refs (none selected = all refs)'
    });
    if (!picked) {
      return;
    }

    const values = picked.map((item) => item.value).filter(Boolean);
    this.filters = { ...this.filters, refs: values };
    this.refSignature = '';
    this.post({ type: 'filters', filters: this.filters });
  }

  private async pickRepo(): Promise<void> {
    const handle = await this.services.repoService.pick();
    if (!handle || handle.root === this.repo.root) {
      return;
    }
    this.repo = handle;
    this.filters = emptyFilters(handle);
    this.filePath = undefined;
    this.rows = [];
    this.graph = [];
    this.hasMore = true;
    this.refSignature = '';
    this.details.clear();
    this.parentIndex.clear();
    this.panel.title = 'Git History';
    await this.sendInit();
    this.post({ type: 'filters', filters: this.filters });
  }

  static async refreshCurrent(): Promise<void> {
    await HistoryPanel.current?.refresh();
  }

  async refresh(): Promise<void> {
    this.lastRefreshAt = Date.now();
    this.abort?.abort();
    this.token += 1;
    this.rows = [];
    this.graph = [];
    this.hasMore = true;
    this.refSignature = '';
    this.lastRefsAt = 0;
    this.details.clear();
    this.parentIndex.clear();
    await this.sendInit();
    this.post({ type: 'filters', filters: this.filters });
  }

  private focus(hash: string): void {
    this.post({ type: 'focusCommit', hash });
  }

  private bindRepo(): void {
    for (const subscription of this.repoSubscriptions) {
      subscription.dispose();
    }
    this.repoSubscriptions = [
      this.repo.repo.onDidCommit(() => this.scheduleRepoRefresh()),
      this.repo.repo.onDidCheckout(() => this.scheduleRepoRefresh())
    ];
  }

  private scheduleRepoRefresh(): void {
    if (!this.ready || Date.now() - this.lastRefreshAt < 1000) {
      return;
    }
    if (this.repoRefreshTimer) {
      clearTimeout(this.repoRefreshTimer);
    }
    this.repoRefreshTimer = setTimeout(() => {
      this.repoRefreshTimer = undefined;
      void this.refresh();
    }, 400);
  }

  private post(message: HostMessage): void {
    void this.panel.webview.postMessage(message);
  }

  private dispose(): void {
    this.abort?.abort();
    if (this.repoRefreshTimer) {
      clearTimeout(this.repoRefreshTimer);
    }
    for (const subscription of this.repoSubscriptions) {
      subscription.dispose();
    }
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.details.clear();
    this.parentIndex.clear();
    if (HistoryPanel.current === this) {
      HistoryPanel.current = undefined;
    }
  }
}
