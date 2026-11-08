import * as vscode from 'vscode';
import * as path from 'node:path';
import type {
  CommitDetail,
  CommitItemLink,
  CommitRow,
  FileChange,
  Filters,
  GraphRow,
  HostMessage,
  RebasePlan,
  RefInfo,
  HistoryColumn,
  WebviewMessage
} from '../../shared/protocol';
import { loadCommitDetail } from '../git/commit';
import { loadDiffFiles } from '../git/diff';
import { loadCommits, type LogQuery } from '../git/log';
import { loadRefs } from '../git/refs';
import { detectOperation, headOid, isConflict } from '../git/write';
import { selectDefaultRefs, type DefaultRefMode } from '../history/defaultRefs';
import { layoutGraph } from '../graph/layout';
import { collapseLinearRows } from '../graph/collapse';
import { parseSearchQuery } from '../../shared/search';
import { CommitActionRunner } from './actions';
import { renderHtml } from './html';
import type { RepoHandle } from './repoService';
import type { Services } from './services';
import { emptyUri, gitUri as toGitUri, worktreeUri } from './uris';

const PAGE_SIZE = 500;

interface ShowOptions {
  repo?: RepoHandle;
  fileUri?: vscode.Uri;
  paths?: string[];
  focus?: string;
  lineRange?: string;
}

function emptyFilters(): Filters {
  return {
    refs: [],
    path: '',
    author: '',
    message: '',
    regex: false,
    caseSensitive: false,
    firstParent: false,
    noMerges: false,
    collapseLinear: false,
    since: '',
    until: '',
    lineRange: undefined,
    order: vscode.workspace.getConfiguration('gitStudio').get<'date' | 'topo'>('history.order', 'date')
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

function sameRefSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  const set = new Set(a);
  return b.every((ref) => set.has(ref));
}

export class HistoryPanel {
  private static current: HistoryPanel | undefined;

  private readonly disposables: vscode.Disposable[] = [];
  private repo: RepoHandle;
  private filters: Filters;
  private filePath: string | undefined;
  private paths: string[] | undefined;
  private refs: RefInfo[] = [];
  private rows: CommitRow[] = [];
  private rawRows: CommitRow[] = [];
  private rowHashes = new Set<string>();
  private graph: GraphRow[] = [];
  private hasMore = true;
  private consumed = 0;
  private refSignature = '';
  private lastRefsAt = 0;
  private refsInitialized = false;
  private refsSource: 'default' | 'custom' | 'all' = 'default';
  private token = 0;
  private abort: AbortController | undefined;
  private ready = false;
  private pendingFocus: string | undefined;
  private pendingRebase: { head: string; label: string; branch: string | null } | undefined;
  private details = new Map<string, CommitDetail>();
  private readonly commitItems = new Map<string, CommitItemLink[]>();
  private readonly parentIndex = new Map<string, number>();
  private readonly actions: CommitActionRunner;
  private repoSubscriptions: vscode.Disposable[] = [];
  private repoRefreshTimer: NodeJS.Timeout | undefined;
  private lastRefreshAt = 0;
  private allRepos = false;

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
        retainContextWhenHidden: true,
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
    this.filters = emptyFilters();
    this.filePath = options.fileUri ? services.repoService.relativePath(repo, options.fileUri) : undefined;
    this.filters.lineRange = options.lineRange;
    this.paths = options.paths?.filter(Boolean);
    if (this.paths && this.paths.length > 0) {
      this.filters.path = this.paths.length === 1 ? this.paths[0] : this.paths.join(', ');
    } else if (this.filePath) {
      this.filters.path = this.filePath;
    }
    this.pendingFocus = options.focus;
    this.actions = new CommitActionRunner(
      services,
      () => this.repo,
      () => this.afterWrite(),
      (plan) => this.post({ type: 'rebasePlan', plan })
    );
    this.bindRepo();

    this.panel.webview.html = renderHtml(panel.webview, services.extensionUri);
    if (this.paths && this.paths.length > 0) {
      panel.title = `History: ${this.paths.length === 1 ? path.basename(this.paths[0]) : `${this.paths.length} paths`}`;
    } else if (this.filePath) {
      panel.title = options.lineRange
        ? `History: ${path.basename(this.filePath)} lines ${options.lineRange}`
        : `History: ${path.basename(this.filePath)}`;
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
      this.filters = emptyFilters();
      this.refsInitialized = false;
      this.refsSource = 'default';
      this.consumed = 0;
      this.filePath = undefined;
      this.paths = undefined;
      this.refs = [];
      this.rows = [];
      this.rawRows = [];
      this.rowHashes.clear();
      this.graph = [];
      this.hasMore = true;
      this.refSignature = '';
      this.details.clear();
      this.parentIndex.clear();
    }

    if (options.paths && options.paths.length > 0) {
      this.paths = options.paths.filter(Boolean);
      this.filePath = this.paths.length === 1 ? this.paths[0] : undefined;
      this.filters = {
        ...this.filters,
        path: this.paths.length === 1 ? this.paths[0] : this.paths.join(', '),
        message: '',
        author: ''
      };
      this.refSignature = '';
      this.panel.title = `History: ${this.paths.length === 1 ? path.basename(this.paths[0]) : `${this.paths.length} paths`}`;
    }

    if (options.fileUri) {
      const relative = this.services.repoService.relativePath(this.repo, options.fileUri);
      if (relative) {
        this.filePath = relative;
        this.filters = {
          ...this.filters,
          path: relative,
          message: '',
          author: '',
          lineRange: options.lineRange
        };
        this.refSignature = '';
        this.panel.title = options.lineRange
          ? `History: ${path.basename(relative)} lines ${options.lineRange}`
          : `History: ${path.basename(relative)}`;
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
          await this.select(message.hash, message.parentIndex ?? 0, message.repoRoot);
          break;
        case 'openBoardItem':
          await vscode.commands.executeCommand('gitStudio.boardOpenItem', {
            uri: this.repo.repo.rootUri,
            providerId: message.providerId,
            kind: message.kind,
            number: message.number
          });
          break;
        case 'openFileDiff':
          await this.openFileDiff(message.hash, message.path, message.oldPath, message.status);
          break;
        case 'openFileWithLocal':
          await this.openFileWithLocal(message.hash, message.path, message.oldPath, message.status, message.before === true);
          break;
        case 'getFileFromRevision':
          await this.getFileFromRevision(message.hash, message.path);
          break;
        case 'fileActions':
          await this.fileActions(message.hash, message.path, message.oldPath, message.status);
          break;
        case 'previewFile':
          await this.previewFile(message.hash, message.path);
          break;
        case 'branchAction':
          await this.branchAction(message);
          break;
        case 'setColumns':
          await vscode.workspace
            .getConfiguration('gitStudio')
            .update('history.columns', message.columns, vscode.ConfigurationTarget.Global);
          await this.sendInit();
          break;
        case 'setTimeField':
          await vscode.workspace
            .getConfiguration('gitStudio')
            .update('history.timeField', message.field, vscode.ConfigurationTarget.Global);
          await this.sendInit();
          break;
        case 'setAllRepos':
          this.allRepos = message.enabled;
          this.consumed = 0;
          this.rows = [];
          this.rawRows = [];
          this.rowHashes.clear();
          this.graph = [];
          this.hasMore = true;
          await this.sendInit();
          break;
        case 'openCommitChanges':
          await this.openCommitChanges(message.hash);
          break;
        case 'commitActions':
          await this.actions.show(message.hash, await this.detailFor(message.hash));
          break;
        case 'abortOperation':
          await this.abortOperation();
          break;
        case 'continueOperation':
          await this.continueOperation();
          break;
        case 'skipOperation':
          await this.skipOperation();
          break;
        case 'undoLastRewrite':
          await this.undoLastRewrite();
          break;
        case 'startRebase':
          await this.startRebase(message.plan);
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
    const operation = await detectOperation(this.services.runner, this.repo.root).catch(() => null);
    const head = await headOid(this.services.runner, this.repo.root);
    const last = this.services.journal.last(this.repo.root);
    const undo = last && head && last.after === head
      ? { label: last.label, before: last.before, after: last.after, branch: last.branch }
      : null;
    const configuration = vscode.workspace.getConfiguration('gitStudio');
    const favorites = configuration.get<string[]>('history.favoriteRefs', []);
    this.refs = this.refs.map((ref) => ({ ...ref, favorite: favorites.includes(ref.name) }));
    const [meName, meEmail, currentBranch, unpushed] = await Promise.all([
      this.services.runner.run(['config', 'user.name'], this.repo.root).then((value) => value.trim()).catch(() => ''),
      this.services.runner.run(['config', 'user.email'], this.repo.root).then((value) => value.trim()).catch(() => ''),
      this.services.runner
        .run(['symbolic-ref', '--short', '-q', 'HEAD'], this.repo.root)
        .then((value) => value.trim())
        .catch(() => ''),
      this.services.runner
        .run(['rev-list', '@{upstream}..HEAD'], this.repo.root)
        .then((value) => value.split('\n').map((line) => line.trim()).filter(Boolean))
        .catch(() => [])
    ]);
    if (!this.refsInitialized || this.refsSource === 'default') {
      this.filters.refs = this.defaultRefs();
      this.refsInitialized = true;
      this.refsSource = 'default';
    } else if (this.refsSource === 'all') {
      this.filters.refs = [];
    }
    this.post({
      type: 'init',
      state: {
        repo: this.services.repoService.summary(this.repo),
        repos: this.services.repoService.list().map((handle) => this.services.repoService.summary(handle)),
        refs: this.refs,
        filters: this.filters,
        filePath: this.filePath ?? null,
        pageSize: Math.max(50, Math.min(5000, pageSize)),
        operation,
        undo,
        me: { name: meName, email: meEmail },
        currentBranch: currentBranch || null,
        favorites,
        columns: configuration.get<HistoryColumn[]>('history.columns', [
          'graph',
          'subject',
          'refs',
          'author',
          'date'
        ]),
        timeField: configuration.get<'author' | 'commit'>('history.timeField', 'author'),
        unpushed,
        allRepos: this.allRepos
      }
    });
  }

  private async loadAllRepos(
    query: LogQuery,
    skip: number,
    limit: number,
    signal: AbortSignal | undefined
  ): Promise<{ rows: CommitRow[]; hasMore: boolean }> {
    const repos = this.services.repoService.list();
    const need = skip + limit;
    const per = Math.min(2000, Math.max(limit, Math.ceil(need / Math.max(1, repos.length)) + 50));
    const results = await Promise.all(
      repos.map(async (handle, index) => {
        const page = await loadCommits(
          this.services.runner,
          handle.root,
          { ...query, refs: [], path: query.path, follow: false, skip: 0, limit: per },
          signal
        );
        return {
          hasMore: page.hasMore,
          rows: page.rows.map((row) => ({
            ...row,
            repoRoot: handle.root,
            repoName: handle.name,
            repoColor: index
          }))
        };
      })
    );
    const merged = results
      .flatMap((result) => result.rows)
      .sort((a, b) => b.commitDate - a.commitDate);
    return {
      rows: merged.slice(skip, skip + limit),
      hasMore: merged.length > need || results.some((result) => result.hasMore)
    };
  }

  private collapseRows(rows: CommitRow[]): CommitRow[] {
    return this.filters.collapseLinear ? collapseLinearRows(rows) : rows;
  }

  private async query(message: Extract<WebviewMessage, { type: 'query' }>): Promise<void> {
    if (!message.append) {
      this.abort?.abort();
      this.abort = new AbortController();
      this.token += 1;
      this.rows = [];
      this.rawRows = [];
      this.rowHashes.clear();
      this.graph = [];
      this.hasMore = true;
      this.filters = { ...message.filters };
      const defaults = this.defaultRefs();
      if (this.filters.refs.length === 0) {
        this.refsSource = 'all';
      } else if (sameRefSet(this.filters.refs, defaults)) {
        this.refsSource = 'default';
      } else {
        this.refsSource = 'custom';
      }
      this.refsInitialized = true;
      if (this.paths && this.filters.path !== (this.paths.length === 1 ? this.paths[0] : this.paths.join(', '))) {
        this.paths = undefined;
      }
      if (this.filePath && this.filters.path !== this.filePath) {
        this.filePath = undefined;
      }
    }

    const token = this.token;
    const signal = this.abort?.signal;
    const skip = message.append ? this.consumed : 0;
    const limit = Math.max(1, Math.min(5000, message.limit));

    this.post({ type: 'busy', busy: true });
    try {
      const stale = await this.checkStale(signal);
      const search = parseSearchQuery(this.filters.message);
      const query: LogQuery = {
        refs: this.filters.refs,
        path: this.paths ? undefined : this.filters.path || search.path || undefined,
        paths: this.paths,
        follow: Boolean(!this.paths && !this.filters.lineRange && (this.filters.path || search.path) && this.filePath),
        author: this.filters.author || search.author,
        message: search.text || undefined,
        hash: search.hash,
        regex: this.filters.regex || Boolean(search.regex),
        caseSensitive: this.filters.caseSensitive || Boolean(search.caseSensitive),
        firstParent: this.filters.firstParent || Boolean(search.firstParent),
        noMerges: this.filters.noMerges || Boolean(search.noMerges),
        mergesOnly: Boolean(search.mergesOnly),
        since: this.filters.since || search.since || undefined,
        until: this.filters.until || search.until || undefined,
        lineRange: this.filters.lineRange,
        order: this.filters.order,
        skip,
        limit
      };

      const result = this.allRepos
        ? await this.loadAllRepos(query, skip, limit, signal)
        : await loadCommits(this.services.runner, this.repo.root, query, signal);
      if (token !== this.token) {
        return;
      }

      const incoming = message.append
        ? result.rows.filter((row) => !this.rowHashes.has(row.hash))
        : result.rows;

      this.rawRows = message.append ? [...this.rawRows, ...incoming] : incoming;
      this.rowHashes = new Set(this.rawRows.map((row) => row.hash));
      this.rows = this.collapseRows(this.rawRows);
      this.graph = this.allRepos
        ? []
        : layoutGraph(this.rows, {
            pruneMissing: Boolean(
              this.filters.message ||
                this.filters.author ||
                this.filters.path ||
                this.filters.since ||
                this.filters.until ||
                this.filters.noMerges ||
                this.filters.collapseLinear ||
                this.paths
            )
          });
      this.hasMore = result.hasMore && result.rows.length > 0;
      this.consumed = message.append ? this.consumed + result.rows.length : result.rows.length;

      this.post({
        type: 'commits',
        requestId: message.requestId,
        append: this.filters.collapseLinear ? false : message.append,
        rows: this.filters.collapseLinear ? this.rows : incoming,
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

  private async select(hash: string, parentIndex = 0, repoRoot?: string): Promise<void> {
    if (repoRoot && repoRoot !== this.repo.root) {
      const handle = this.services.repoService.list().find((candidate) => candidate.root === repoRoot);
      if (handle) {
        this.repo = handle;
        this.bindRepo();
        this.details.clear();
        this.parentIndex.clear();
        await this.sendInit();
      }
    }
    this.parentIndex.set(hash, parentIndex);
    const key = `${hash}:${parentIndex}`;
    const cached = this.details.get(key);
    if (cached) {
      this.post({ type: 'detail', hash, detail: cached });
      void this.postCommitItems(hash, cached);
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
      void this.postCommitItems(hash, detail);
    } catch (error) {
      this.post({ type: 'detail', hash, detail: null, error: errorText(error) });
    }
  }

  private async postCommitItems(hash: string, detail?: CommitDetail): Promise<void> {
    const cached = this.commitItems.get(hash);
    if (cached) {
      this.post({ type: 'commitItems', hash, items: cached });
      return;
    }
    // A merge or squash commit already names its change request; don't spend an API call on it.
    if (detail && /(?:^|\s)[!#]\d+|https?:\/\/[^\s]+\/(?:pull|issues|merge_requests|-\/merge_requests)\/\d+/i.test(detail.message)) {
      this.commitItems.set(hash, []);
      this.post({ type: 'commitItems', hash, items: [] });
      return;
    }
    try {
      const items = await vscode.commands.executeCommand<CommitItemLink[]>(
        'gitStudio.boardFindCommitItems',
        { root: this.repo.root, sha: hash }
      );
      const value = items ?? [];
      this.commitItems.set(hash, value);
      this.post({ type: 'commitItems', hash, items: value });
    } catch (error) {
      this.services.output.warn(`commit board lookup failed: ${errorText(error)}`);
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
      `${path.basename(filePath)} (${shortHash(hash)})`,
      { viewColumn: vscode.ViewColumn.Beside, preview: true }
    );
  }

  private async openFileWithLocal(
    hash: string,
    filePath: string,
    oldPath: string | undefined,
    status: FileChange['status'],
    before: boolean
  ): Promise<void> {
    const detail = await this.detailFor(hash);
    if (!detail) {
      return;
    }
    const oldFile = oldPath ?? filePath;
    const parent = detail.parents[detail.parentIndex];
    const left = before
      ? parent
        ? this.gitUri(oldFile, parent)
        : emptyUri(oldFile)
      : status === 'A'
        ? emptyUri(oldFile)
        : this.gitUri(oldFile, hash);
    const right = status === 'D' ? emptyUri(filePath) : worktreeUri(this.repo, filePath);
    const label = before ? 'before' : shortHash(hash);
    await vscode.commands.executeCommand(
      'vscode.diff',
      left,
      right,
      `${path.basename(filePath)} (${label} ↔ Working Tree)`,
      { viewColumn: vscode.ViewColumn.Beside, preview: true }
    );
  }

  private async getFileFromRevision(hash: string, filePath: string): Promise<void> {
    const answer = await vscode.window.showWarningMessage(
      `Replace the working tree and index copy of ${filePath} with its version at ${shortHash(hash)}?`,
      { modal: true },
      'Replace'
    );
    if (answer !== 'Replace') {
      return;
    }
    const head = await headOid(this.services.runner, this.repo.root);
    try {
      await this.services.writes.restoreFile(this.repo.root, hash, filePath, head);
      await this.afterWrite();
      void vscode.window.showInformationMessage(`Git Studio: restored ${filePath} from ${shortHash(hash)}.`);
    } catch (error) {
      void vscode.window.showErrorMessage(`Git Studio: ${errorText(error)}`);
    }
  }

  private async branchAction(message: Extract<WebviewMessage, { type: 'branchAction' }>): Promise<void> {
    const ref = this.refs.find((candidate) => candidate.name === message.ref || candidate.shortName === message.ref);
    if (!ref && message.action !== 'create') {
      void vscode.window.showWarningMessage('Git Studio: that branch is no longer available.');
      return;
    }
    const configuration = vscode.workspace.getConfiguration('gitStudio');
    const favorites = configuration.get<string[]>('history.favoriteRefs', []);

    if (message.action === 'favorite') {
      const next = favorites.includes(message.ref)
        ? favorites.filter((item) => item !== message.ref)
        : [...favorites, message.ref];
      await configuration.update('history.favoriteRefs', next, vscode.ConfigurationTarget.Global);
      await this.sendInit();
      return;
    }

    const head = await headOid(this.services.runner, this.repo.root);
    let args: string[] | undefined;
    switch (message.action) {
      case 'checkout':
        args = ref!.type === 'remote'
          ? ['checkout', '-b', ref!.shortName.split('/').slice(1).join('/'), '--track', ref!.shortName]
          : ['checkout', ref!.shortName];
        break;
      case 'create': {
        const name = await vscode.window.showInputBox({ prompt: 'New branch name', value: message.name ?? '' });
        if (!name?.trim()) {
          return;
        }
        args = ['checkout', '-b', name.trim(), ref?.shortName ?? 'HEAD'];
        break;
      }
      case 'delete': {
        const answer = await vscode.window.showWarningMessage(`Delete branch ${ref!.shortName}?`, { modal: true }, 'Delete');
        if (answer !== 'Delete') {
          return;
        }
        args = ['branch', '-d', ref!.shortName];
        break;
      }
      case 'rename': {
        const name = await vscode.window.showInputBox({ prompt: `Rename ${ref!.shortName} to`, value: ref!.shortName });
        if (!name?.trim() || name.trim() === ref!.shortName) {
          return;
        }
        args = ['branch', '-m', ref!.shortName, name.trim()];
        break;
      }
      case 'merge': {
        const answer = await vscode.window.showWarningMessage(
          `Merge ${ref!.shortName} into the current branch?`,
          { modal: true },
          'Merge'
        );
        if (answer !== 'Merge') {
          return;
        }
        args = ['merge', '--no-edit', ref!.shortName];
        break;
      }
      case 'rebase': {
        const answer = await vscode.window.showWarningMessage(
          `Rebase the current branch onto ${ref!.shortName}?`,
          { modal: true },
          'Rebase'
        );
        if (answer !== 'Rebase') {
          return;
        }
        args = ['rebase', ref!.shortName];
        break;
      }
    }
    if (!args) {
      return;
    }

    try {
      await this.services.writes.command(this.repo.root, args, head);
      await this.afterWrite();
    } catch (error) {
      void vscode.window.showErrorMessage(`Git Studio: ${errorText(error)}`);
    }
  }

  private async fileActions(
    hash: string,
    filePath: string,
    oldPath: string | undefined,
    status: FileChange['status']
  ): Promise<void> {
    const picked = await vscode.window.showQuickPick(
      [
        { id: 'diff', label: '$(diff) Show Diff' },
        { id: 'preview', label: '$(preview) Preview Diff' },
        { id: 'local', label: '$(compare-changes) Compare with Working Tree' },
        { id: 'before', label: '$(compare-changes) Compare Before with Working Tree' },
        { id: 'history', label: '$(history) File History' },
        { id: 'revision', label: '$(go-to-file) Open at This Revision' },
        { id: 'annotate', label: '$(symbol-parameter) Annotate This Revision' },
        { id: 'copy', label: '$(copy) Copy Path' },
        { id: 'restore', label: '$(cloud-download) Get This File from This Revision' },
        { id: 'revert', label: '$(discard) Revert This File\u2019s Changes' },
        { id: 'cherry-pick', label: '$(git-commit) Apply This File\u2019s Changes to Working Tree' },
        { id: 'drop', label: '$(trash) Drop This File\u2019s Changes from the Commit' },
        { id: 'extract', label: '$(split-horizontal) Extract This File\u2019s Changes to a New Commit' }
      ],
      { title: `${path.basename(filePath)} · ${shortHash(hash)}`, placeHolder: 'Choose a file action' }
    );
    if (!picked) {
      return;
    }

    const file: FileChange = { path: filePath, oldPath, status, additions: 0, deletions: 0, binary: false };
    switch (picked.id) {
      case 'diff':
        await this.openFileDiff(hash, filePath, oldPath, status);
        return;
      case 'preview':
        await this.previewFile(hash, filePath);
        return;
      case 'local':
        await this.openFileWithLocal(hash, filePath, oldPath, status, false);
        return;
      case 'before':
        await this.openFileWithLocal(hash, filePath, oldPath, status, true);
        return;
      case 'history':
        this.openFileHistory(filePath);
        return;
      case 'revision':
        await this.openFileAtRevision(hash, filePath);
        return;
      case 'annotate':
        await this.annotateRevision(hash, filePath);
        return;
      case 'copy':
        await vscode.env.clipboard.writeText(filePath);
        return;
      case 'restore':
        await this.getFileFromRevision(hash, filePath);
        return;
      case 'revert':
        await this.applyFileChanges(file, hash, true);
        return;
      case 'cherry-pick':
        await this.applyFileChanges(file, hash, false);
        return;
      case 'drop':
        await this.actions.dropFile(hash, await this.detailFor(hash), filePath);
        return;
      case 'extract':
        await this.actions.extractFile(hash, await this.detailFor(hash), filePath);
        return;
    }
  }

  private async previewFile(hash: string, filePath: string): Promise<void> {
    const detail = await this.detailFor(hash);
    if (!detail) {
      return;
    }
    const parent = detail.parents[detail.parentIndex];
    try {
      const patch = parent
        ? await this.services.runner.run(['diff', parent, hash, '--', filePath], this.repo.root)
        : await this.services.runner.run(['show', '--format=', hash, '--', filePath], this.repo.root);
      this.post({ type: 'filePreview', hash, path: filePath, patch });
    } catch (error) {
      this.post({ type: 'filePreview', hash, path: filePath, patch: '', error: errorText(error) });
    }
  }

  private async annotateRevision(hash: string, filePath: string): Promise<void> {
    try {
      const uri = this.gitUri(filePath, hash);
      const document = await vscode.workspace.openTextDocument(uri);
      const editor = await vscode.window.showTextDocument(document, {
        preview: true,
        viewColumn: vscode.ViewColumn.Beside
      });
      await this.services.annotate?.show(editor);
    } catch (error) {
      void vscode.window.showErrorMessage(`Git Studio: cannot annotate ${filePath} at ${shortHash(hash)}: ${errorText(error)}`);
    }
  }

  private async applyFileChanges(file: FileChange, hash: string, reverse: boolean): Promise<void> {
    const detail = await this.detailFor(hash);
    if (!detail) {
      return;
    }
    const label = reverse ? 'Revert' : 'Apply';
    const answer = await vscode.window.showWarningMessage(
      `${label} the changes to ${file.path} from ${shortHash(hash)} in the working tree?`,
      { modal: true },
      label
    );
    if (answer !== label) {
      return;
    }
    const head = await headOid(this.services.runner, this.repo.root);
    try {
      await this.services.writes.applyFilePatch(
        this.repo.root,
        hash,
        detail.parents[detail.parentIndex],
        file.path,
        reverse,
        head
      );
      await this.afterWrite();
      void vscode.window.showInformationMessage(`Git Studio: ${label.toLowerCase()}ed ${file.path}.`);
    } catch (error) {
      void vscode.window.showErrorMessage(`Git Studio: ${errorText(error)}`);
    }
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
    this.consumed = 0;
    this.filters = {
      ...this.filters,
      path: filePath,
      message: '',
      author: '',
      lineRange: undefined
    };
    this.refSignature = '';
    this.rows = [];
    this.rawRows = [];
    this.rowHashes.clear();
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
    try {
      this.refs = await loadRefs(this.services.runner, this.repo.root);
      this.lastRefsAt = Date.now();
    } catch (error) {
      this.services.output.warn(`failed to refresh refs: ${errorText(error)}`);
    }

    const defaults = this.defaultRefs();
    const isDefault = sameRefSet(this.filters.refs, defaults);

    const refItem = (ref: RefInfo) => ({
      label: ref.shortName,
      description: ref.current ? 'current' : ref.type === 'tag' ? 'tag' : ref.type === 'remote' ? 'remote' : 'branch',
      detail: ref.oid.slice(0, 8),
      picked: this.filters.refs.includes(ref.name),
      value: ref.name
    });

    const locals = this.refs.filter((ref) => ref.type === 'local' || ref.type === 'head');
    const remotes = this.refs.filter((ref) => ref.type === 'remote');
    const tags = this.refs.filter((ref) => ref.type === 'tag');

    const items: (vscode.QuickPickItem & { value?: string })[] = [
      {
        label: '$(list-unordered) Default refs',
        description: `${defaults.length} refs`,
        picked: isDefault,
        value: '__default__'
      },
      {
        label: '$(globe) All refs',
        description: 'Every branch, remote and tag',
        picked: this.filters.refs.length === 0,
        value: '__all__'
      }
    ];

    const addGroup = (label: string, group: RefInfo[]) => {
      if (group.length === 0) {
        return;
      }
      items.push({ label, kind: vscode.QuickPickItemKind.Separator });
      items.push(...group.map(refItem));
    };

    addGroup('Local branches', locals);
    addGroup('Remote branches', remotes);
    addGroup('Tags', tags);

    const picked = await vscode.window.showQuickPick(items, {
      canPickMany: true,
      matchOnDescription: true,
      placeHolder: 'Refs included in the graph (Default refs or All refs override individual picks)'
    });
    if (!picked) {
      return;
    }

    const values = picked
      .map((item) => item.value)
      .filter((value): value is string => Boolean(value));

    let refs: string[];
    const specifics = values.filter((value) => !value.startsWith('__'));
    if (values.includes('__all__')) {
      refs = [];
    } else if (specifics.length > 0) {
      refs = specifics;
    } else if (values.includes('__default__')) {
      refs = defaults;
    } else {
      refs = [];
    }

    this.filters = { ...this.filters, refs };
    this.refsInitialized = true;
    this.refsSource = refs.length === 0 ? 'all' : sameRefSet(refs, defaults) ? 'default' : 'custom';
    this.refSignature = '';
    this.post({ type: 'filters', filters: this.filters });
  }

  private async pickRepo(): Promise<void> {
    const handle = await this.services.repoService.pick();
    if (!handle || handle.root === this.repo.root) {
      return;
    }
    this.repo = handle;
    this.filters = emptyFilters();
    this.refsInitialized = false;
    this.refsSource = 'default';
    this.consumed = 0;
    this.filePath = undefined;
    this.rows = [];
    this.rawRows = [];
    this.rowHashes.clear();
    this.graph = [];
    this.hasMore = true;
    this.refSignature = '';
    this.details.clear();
    this.parentIndex.clear();
    this.panel.title = 'Git History';
    await this.sendInit();
    this.post({ type: 'filters', filters: this.filters });
  }

  private async abortOperation(): Promise<void> {
    const operation = await detectOperation(this.services.runner, this.repo.root);
    if (!operation) {
      this.post({ type: 'operation', operation: null });
      return;
    }

    const answer = await vscode.window.showWarningMessage(`Abort the ${operation} in progress?`, { modal: true }, 'Abort');
    if (answer !== 'Abort') {
      return;
    }

    await this.services.writes.abort(this.repo.root);
    this.pendingRebase = undefined;
    await this.afterWrite();
  }

  private async continueOperation(): Promise<void> {
    try {
      const result = await this.services.writes.continueOperation(this.repo.root);
      if (result === 'done') {
        await this.recordPendingRebase();
      }
      await this.afterWrite();
      if (result === 'stopped') {
        this.post({ type: 'error', message: 'Rebase stopped again. Amend or resolve, then Continue.' });
      }
    } catch (error) {
      await this.afterWrite();
      if (isConflict(error)) {
        this.post({ type: 'error', message: 'Still conflicted. Resolve the files in Source Control, then Continue again.' });
        return;
      }
      throw error;
    }
  }

  private async skipOperation(): Promise<void> {
    try {
      const result = await this.services.writes.skipOperation(this.repo.root);
      if (result === 'done') {
        await this.recordPendingRebase();
      }
      await this.afterWrite();
      if (result === 'stopped') {
        this.post({ type: 'error', message: 'Rebase stopped again. Amend or resolve, then Continue.' });
      }
    } catch (error) {
      await this.afterWrite();
      if (isConflict(error)) {
        this.post({ type: 'error', message: 'Still conflicted. Resolve the files in Source Control, then Skip or Abort.' });
        return;
      }
      throw error;
    }
  }

  private async startRebase(plan: RebasePlan): Promise<void> {
    if (plan.error) {
      return;
    }

    this.pendingRebase = { head: plan.head, label: `rebase ${plan.items.length} commits`, branch: plan.branch };
    await this.services.journal.record(this.repo.root, {
      label: this.pendingRebase.label,
      before: plan.head,
      after: plan.head,
      branch: plan.branch,
      at: Date.now(),
      pending: true
    });
    try {
      const result = await this.services.writes.rebase(this.repo.root, plan, plan.head);
      if (result === 'done') {
        await this.recordPendingRebase();
        await this.afterWrite();
        void vscode.window.showInformationMessage(`Git Studio: rebased ${plan.items.length} commits.`);
      } else {
        await this.afterWrite();
        void vscode.window.showInformationMessage('Git Studio: rebase stopped for edit. Amend the commit, then Continue or Skip.');
      }
    } catch (error) {
      await this.afterWrite();
      if (isConflict(error)) {
        this.post({ type: 'error', message: 'Rebase stopped with conflicts. Resolve them in Source Control, then Continue or Abort.' });
        return;
      }
      const operation = await detectOperation(this.services.runner, this.repo.root).catch(() => null);
      if (operation !== 'rebase') {
        this.pendingRebase = undefined;
      }
      throw error;
    }
  }

  private async recordPendingRebase(): Promise<void> {
    const pending = this.pendingRebase;
    this.pendingRebase = undefined;
    if (!pending) {
      return;
    }
    const after = await headOid(this.services.runner, this.repo.root);
    if (!after || after === pending.head) {
      await this.services.journal.pop(this.repo.root);
      return;
    }
    await this.services.journal.updateLast(this.repo.root, {
      after,
      pending: false
    });
  }

  private async undoLastRewrite(): Promise<void> {
    const entry = this.services.journal.last(this.repo.root);
    if (!entry) {
      this.post({ type: 'undo', undo: null });
      return;
    }

    const head = await headOid(this.services.runner, this.repo.root);
    if (entry.pending) {
      const answer = await vscode.window.showWarningMessage(
        `Abort the in-progress ${entry.label}? It will return ${entry.branch ?? 'HEAD'} to ${entry.before.slice(0, 7)}.`,
        { modal: true },
        'Abort'
      );
      if (answer !== 'Abort') {
        return;
      }
      await this.services.writes.abort(this.repo.root);
      await this.services.journal.pop(this.repo.root);
      await this.afterWrite();
      void vscode.window.showInformationMessage(`Git Studio: aborted ${entry.label}.`);
      return;
    }
    if (!head || head !== entry.after) {
      void vscode.window.showWarningMessage(
        'Git Studio: history changed since the last rewrite, so it cannot be undone safely. Refresh first.'
      );
      await this.afterWrite();
      return;
    }

    const answer = await vscode.window.showWarningMessage(
      `Undo ${entry.label}? ${entry.branch ?? 'HEAD'} will be reset to ${entry.before.slice(0, 7)}. Tracked working tree changes are kept when possible.`,
      { modal: true },
      'Undo'
    );
    if (answer !== 'Undo') {
      return;
    }

    try {
      await this.services.writes.reset(this.repo.root, entry.before, 'keep', head);
    } catch (error) {
      void vscode.window.showErrorMessage(
        `Git Studio: could not undo without overwriting local changes. Commit or stash them first. ${errorText(error)}`
      );
      return;
    }
    await this.services.journal.pop(this.repo.root);
    await this.afterWrite();
    void vscode.window.showInformationMessage(`Git Studio: undid ${entry.label}.`);
  }

  private async afterWrite(): Promise<void> {
    try {
      await this.repo.repo.status();
    } catch (error) {
      this.services.output.warn(`status refresh failed: ${errorText(error)}`);
    }
    await this.refresh();
  }

  static async refreshCurrent(): Promise<void> {
    await HistoryPanel.current?.refresh();
  }

  static async undoCurrent(): Promise<void> {
    await HistoryPanel.current?.undoLastRewrite();
  }

  async refresh(): Promise<void> {
    this.lastRefreshAt = Date.now();
    this.consumed = 0;
    this.abort?.abort();
    this.token += 1;
    this.rows = [];
    this.rawRows = [];
    this.rowHashes.clear();
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

  private defaultRefs(): string[] {
    const configuration = vscode.workspace.getConfiguration('gitStudio');
    return selectDefaultRefs(this.refs, {
      mode: configuration.get<DefaultRefMode>('history.defaultRefs', 'primary'),
      recentLimit: configuration.get<number>('history.recentRefLimit', 4),
      pinned: configuration.get<string[]>('history.pinnedRefs', [])
    });
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
