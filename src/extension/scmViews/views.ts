import * as vscode from 'vscode';
import * as path from 'node:path';
import type { CommitRow, FileChange } from '../../shared/protocol';
import { loadCommitDetail } from '../git/commit';
import { loadCommits } from '../git/log';
import type { RepoHandle } from '../host/repoService';
import { emptyUri } from '../host/uris';
import type { Services } from '../host/services';

interface CommitFilters {
  message: string;
  author: string;
  path: string;
  since: string;
  until: string;
  firstParent: boolean;
  order: 'date' | 'topo';
}

interface CommitNode {
  kind: 'commit';
  repoRoot: string;
  row: CommitRow;
  filePath?: string;
}

interface InfoNode {
  kind: 'info';
  label: string;
  description?: string;
}

interface LoadMoreNode {
  kind: 'loadMore';
}

type HistoryNode = CommitNode | InfoNode | LoadMoreNode;

const FILTER_KEY = 'gitStudio.scm.commits.filters';
const PAGE_SIZE = 100;

function emptyFilters(): CommitFilters {
  return { message: '', author: '', path: '', since: '', until: '', firstParent: false, order: 'date' };
}

function filterCount(filters: CommitFilters): number {
  return [filters.message, filters.author, filters.path, filters.since, filters.until].filter(Boolean).length
    + (filters.firstParent ? 1 : 0);
}

function ago(seconds: number): string {
  const delta = Math.max(0, Date.now() / 1000 - seconds);
  const units: [number, string][] = [[365 * 24 * 3600, 'y'], [30 * 24 * 3600, 'mo'], [24 * 3600, 'd'], [3600, 'h'], [60, 'm']];
  for (const [size, label] of units) {
    if (delta >= size) {
      return `${Math.floor(delta / size)}${label} ago`;
    }
  }
  return 'just now';
}

function info(label: string, description?: string): InfoNode {
  return { kind: 'info', label, description };
}

function commitNode(repoRoot: string, row: CommitRow, filePath?: string): CommitNode {
  return { kind: 'commit', repoRoot, row, filePath };
}

function commitItem(node: CommitNode): vscode.TreeItem {
  const item = new vscode.TreeItem(node.row.subject || '(no subject)', vscode.TreeItemCollapsibleState.None);
  item.description = `${node.row.authorName} · ${ago(node.row.authorDate)} · ${node.row.shortHash}`;
  item.tooltip = `${node.row.subject}\n${node.row.authorName} <${node.row.authorEmail}> · ${new Date(node.row.authorDate * 1000).toLocaleString()}\n${node.row.hash}`;
  item.iconPath = new vscode.ThemeIcon('git-commit');
  item.contextValue = 'gitStudio.commit';
  item.command = {
    command: 'gitStudio.scm.openCommit',
    title: 'Open Changes',
    arguments: [node.repoRoot, node.row.hash, node.filePath]
  };
  return item;
}

function infoItem(node: InfoNode): vscode.TreeItem {
  const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.None);
  item.description = node.description;
  item.iconPath = new vscode.ThemeIcon('info');
  item.contextValue = 'gitStudio.info';
  return item;
}

abstract class CommitTreeProvider implements vscode.TreeDataProvider<HistoryNode> {
  protected rows: CommitRow[] = [];
  protected empty = 'No commits.';
  protected repoRoot: string | undefined;
  protected filePath: string | undefined;
  private view: vscode.TreeView<HistoryNode> | undefined;
  private readonly changed = new vscode.EventEmitter<HistoryNode | undefined>();
  readonly onDidChangeTreeData = this.changed.event;

  constructor(protected readonly services: Services) {}

  attach(view: vscode.TreeView<HistoryNode>): void {
    this.view = view;
  }

  getTreeItem(node: HistoryNode): vscode.TreeItem {
    if (node.kind === 'commit') {
      return commitItem(node);
    }
    if (node.kind === 'loadMore') {
      const item = new vscode.TreeItem('Load more…', vscode.TreeItemCollapsibleState.None);
      item.iconPath = new vscode.ThemeIcon('ellipsis');
      item.command = { command: 'gitStudio.scm.commits.loadMore', title: 'Load more commits' };
      return item;
    }
    return infoItem(node);
  }

  getChildren(node?: HistoryNode): HistoryNode[] {
    if (node) {
      return [];
    }
    if (this.rows.length === 0) {
      return [info(this.empty)];
    }
    return this.rows.map((row) => commitNode(this.repoRoot ?? '', row, this.filePath));
  }

  protected notify(): void {
    this.changed.fire(undefined);
  }

  protected setDescription(text: string): void {
    if (this.view) {
      this.view.description = text;
    }
  }

  protected setMessage(text: string): void {
    if (this.view) {
      this.view.message = text;
    }
  }

  abstract refresh(): Promise<void>;
}

class FileHistoryProvider extends CommitTreeProvider {
  private sequence = 0;

  constructor(services: Services, private readonly getEditor: () => vscode.TextEditor | undefined) {
    super(services);
  }

  async refresh(): Promise<void> {
    const current = ++this.sequence;
    const editor = this.getEditor();
    if (!editor || editor.document.uri.scheme !== 'file') {
      this.rows = [];
      this.filePath = undefined;
      this.repoRoot = undefined;
      this.empty = 'Open a file to see its history.';
      this.setDescription('');
      this.setMessage('');
      this.notify();
      return;
    }

    const handle = this.services.repoService.forUri(editor.document.uri) ?? this.services.repoService.active();
    const relative = handle ? this.services.repoService.relativePath(handle, editor.document.uri) : undefined;
    if (!handle || !relative) {
      this.rows = [];
      this.empty = 'This file is not inside a Git repository.';
      this.setDescription('');
      this.notify();
      return;
    }

    try {
      const result = await loadCommits(this.services.runner, handle.root, {
        refs: ['HEAD'],
        path: relative,
        follow: true,
        order: 'date',
        skip: 0,
        limit: 200
      });
      if (current !== this.sequence) {
        return;
      }
      this.rows = result.rows;
      this.repoRoot = handle.root;
      this.filePath = relative;
      this.empty = 'No commits touch this file.';
      this.setDescription(relative);
      this.setMessage('');
      this.notify();
    } catch (error) {
      if (current !== this.sequence) {
        return;
      }
      this.services.output.warn(`scm file failed: ${error instanceof Error ? error.message : String(error)}`);
      this.rows = [];
      this.empty = 'Unable to load file history.';
      this.setMessage(error instanceof Error ? error.message.split('\n')[0] : String(error));
      this.notify();
    }
  }
}

class LineHistoryProvider extends CommitTreeProvider {
  private sequence = 0;
  private key = '';

  constructor(services: Services, private readonly getEditor: () => vscode.TextEditor | undefined) {
    super(services);
  }

  async refresh(force = true): Promise<void> {
    const editor = this.getEditor();
    if (!editor || editor.document.uri.scheme !== 'file') {
      this.rows = [];
      this.filePath = undefined;
      this.repoRoot = undefined;
      this.key = '';
      this.empty = 'Open a file and select lines to see their history.';
      this.setDescription('');
      this.setMessage('');
      this.notify();
      return;
    }

    const start = Math.min(editor.selection.start.line, editor.selection.end.line) + 1;
    const end = Math.max(editor.selection.start.line, editor.selection.end.line) + 1;
    const key = `${editor.document.uri.toString()}:${start}:${end}`;
    if (!force && key === this.key) {
      return;
    }
    this.key = key;

    const handle = this.services.repoService.forUri(editor.document.uri) ?? this.services.repoService.active();
    const relative = handle ? this.services.repoService.relativePath(handle, editor.document.uri) : undefined;
    if (!handle || !relative) {
      this.rows = [];
      this.empty = 'This file is not inside a Git repository.';
      this.setDescription('');
      this.notify();
      return;
    }

    const current = ++this.sequence;
    try {
      const result = await loadCommits(this.services.runner, handle.root, {
        refs: ['HEAD'],
        path: relative,
        lineRange: `${start},${end}`,
        order: 'date',
        skip: 0,
        limit: 200
      });
      if (current !== this.sequence) {
        return;
      }
      this.rows = result.rows;
      this.repoRoot = handle.root;
      this.filePath = relative;
      this.empty = 'No commits touch these lines.';
      this.setDescription(start === end ? `${path.basename(relative)} ${start}` : `${path.basename(relative)} ${start}-${end}`);
      this.setMessage('');
      this.notify();
    } catch (error) {
      if (current !== this.sequence) {
        return;
      }
      this.rows = [];
      this.empty = 'Unable to load line history.';
      this.setMessage(error instanceof Error ? error.message.split('\n')[0] : String(error));
      this.notify();
    }
  }
}

class CommitsProvider extends CommitTreeProvider {
  private sequence = 0;
  private filters: CommitFilters;
  private includeMerges = false;
  private limit = PAGE_SIZE;
  private hasMore = false;
  private branch = 'HEAD';

  constructor(services: Services, private readonly state: vscode.Memento) {
    super(services);
    const saved = state.get<Partial<CommitFilters>>(FILTER_KEY);
    this.filters = { ...emptyFilters(), ...saved };
  }

  async refresh(): Promise<void> {
    const handle = this.services.repoService.active();
    if (!handle) {
      this.rows = [];
      this.empty = 'No Git repository in this workspace.';
      this.repoRoot = undefined;
      this.setDescription('');
      this.setMessage('');
      this.notify();
      return;
    }

    const current = ++this.sequence;
    this.branch = handle.repo.state.HEAD?.name ?? 'HEAD';
    try {
      const result = await loadCommits(this.services.runner, handle.root, {
        refs: ['HEAD'],
        noMerges: !this.includeMerges,
        firstParent: this.filters.firstParent,
        author: this.filters.author || undefined,
        message: this.filters.message || undefined,
        path: this.filters.path || undefined,
        since: this.filters.since || undefined,
        until: this.filters.until || undefined,
        order: this.filters.order,
        skip: 0,
        limit: this.limit
      });
      if (current !== this.sequence) {
        return;
      }
      this.rows = result.rows;
      this.hasMore = result.hasMore;
      this.repoRoot = handle.root;
      this.empty = 'No commits match the current filters.';
      const filtered = filterCount(this.filters) > 0;
      const suffix = filtered ? ' · filtered' : this.includeMerges ? ' · merges' : '';
      this.setDescription(`${this.branch}${suffix}`);
      this.setMessage('');
      this.notify();
    } catch (error) {
      if (current !== this.sequence) {
        return;
      }
      this.rows = [];
      this.hasMore = false;
      this.empty = 'Unable to load commits.';
      this.setMessage(error instanceof Error ? error.message.split('\n')[0] : String(error));
      this.notify();
    }
  }

  getChildren(node?: HistoryNode): HistoryNode[] {
    if (node) {
      return [];
    }
    if (this.rows.length === 0) {
      return [info(this.empty)];
    }
    const items: HistoryNode[] = this.rows.map((row) => commitNode(this.repoRoot ?? '', row));
    if (this.hasMore) {
      items.push({ kind: 'loadMore' });
    }
    return items;
  }

  async toggleMerges(): Promise<void> {
    this.includeMerges = !this.includeMerges;
    this.limit = PAGE_SIZE;
    await this.refresh();
  }

  async loadMore(): Promise<void> {
    this.limit += PAGE_SIZE;
    await this.refresh();
  }

  async clearFilters(): Promise<void> {
    this.filters = emptyFilters();
    this.limit = PAGE_SIZE;
    this.save();
    await this.refresh();
  }

  async pickFilter(): Promise<void> {
    const items: (vscode.QuickPickItem & { action: string })[] = [
      { label: '$(edit) Message', description: this.filters.message || 'any', action: 'message' },
      { label: '$(person) Author', description: this.filters.author || 'any', action: 'author' },
      { label: '$(file) Path', description: this.filters.path || 'any', action: 'path' },
      { label: '$(calendar) Since', description: this.filters.since || 'any', action: 'since' },
      { label: '$(calendar) Until', description: this.filters.until || 'any', action: 'until' },
      { label: '$(list-ordered) Order', description: this.filters.order === 'date' ? 'date' : 'topological', action: 'order' },
      { label: '$(git-commit) First parent only', description: this.filters.firstParent ? 'on' : 'off', action: 'firstParent' },
      { label: '$(git-merge) Merge commits', description: this.includeMerges ? 'included' : 'excluded', action: 'merges' },
      { label: '$(clear-all) Clear all filters', action: 'clear' }
    ];
    const picked = await vscode.window.showQuickPick(items, { title: 'Filter Commits', placeHolder: 'Choose a filter to change' });
    if (!picked) {
      return;
    }

    if (picked.action === 'clear') {
      await this.clearFilters();
      return;
    }
    if (picked.action === 'merges') {
      await this.toggleMerges();
      return;
    }
    if (picked.action === 'firstParent') {
      this.filters.firstParent = !this.filters.firstParent;
      this.limit = PAGE_SIZE;
      this.save();
      await this.refresh();
      return;
    }
    if (picked.action === 'order') {
      const order = await vscode.window.showQuickPick(
        [
          { label: 'Date order', value: 'date' as const },
          { label: 'Topological order', value: 'topo' as const }
        ],
        { title: 'Commit order' }
      );
      if (!order) {
        return;
      }
      this.filters.order = order.value;
      this.limit = PAGE_SIZE;
      this.save();
      await this.refresh();
      return;
    }

    const key = picked.action as 'message' | 'author' | 'path' | 'since' | 'until';
    const value = await vscode.window.showInputBox({
      title: picked.label.replace(/\$\([^)]*\)\s*/, ''),
      value: this.filters[key],
      prompt: key === 'since' || key === 'until' ? 'Git date, for example 2026-01-01 or 2 weeks ago' : 'Leave empty to clear'
    });
    if (value === undefined) {
      return;
    }
    this.filters[key] = value.trim();
    this.limit = PAGE_SIZE;
    this.save();
    await this.refresh();
  }

  private save(): void {
    void this.state.update(FILTER_KEY, this.filters);
  }
}

function debounce(fn: () => void, delay: number): () => void {
  let timer: NodeJS.Timeout | undefined;
  return () => {
    if (timer) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      timer = undefined;
      fn();
    }, delay);
  };
}

function shortHash(hash: string): string {
  return hash.slice(0, 7);
}

function gitUri(services: Services, handle: RepoHandle, filePath: string, ref: string): vscode.Uri {
  return services.repoService.toGitUri(vscode.Uri.joinPath(handle.repo.rootUri, filePath), ref);
}

function fileUris(
  services: Services,
  handle: RepoHandle,
  file: FileChange,
  hash: string,
  parent: string | undefined
): [vscode.Uri, vscode.Uri, vscode.Uri] {
  const oldPath = file.oldPath ?? file.path;
  const left = file.status === 'A' || !parent ? emptyUri(oldPath) : gitUri(services, handle, oldPath, parent);
  const right = file.status === 'D' ? emptyUri(file.path) : gitUri(services, handle, file.path, hash);
  return [vscode.Uri.joinPath(handle.repo.rootUri, file.path), left, right];
}

async function openCommitView(
  services: Services,
  handle: RepoHandle,
  hash: string,
  filePath?: string
): Promise<void> {
  const detail = await loadCommitDetail(services.runner, handle.root, hash);
  if (!detail) {
    void vscode.window.showWarningMessage(`Git Studio: cannot load ${shortHash(hash)}.`);
    return;
  }
  const parent = detail.parents[detail.parentIndex];

  if (filePath) {
    const file = detail.files.find((entry) => entry.path === filePath || entry.oldPath === filePath);
    const [, left, right] = file
      ? fileUris(services, handle, file, hash, parent)
      : [
          vscode.Uri.joinPath(handle.repo.rootUri, filePath),
          parent ? gitUri(services, handle, filePath, parent) : emptyUri(filePath),
          gitUri(services, handle, filePath, hash)
        ];
    await vscode.commands.executeCommand(
      'vscode.diff',
      left,
      right,
      `${path.basename(filePath)} (${shortHash(hash)})`,
      { viewColumn: vscode.ViewColumn.Beside, preview: true }
    );
    return;
  }

  if (detail.files.length === 0) {
    void vscode.window.showInformationMessage(`Git Studio: ${shortHash(hash)} has no changed files.`);
    return;
  }
  const entries = detail.files.map((file) => fileUris(services, handle, file, hash, parent));
  try {
    await vscode.commands.executeCommand('vscode.changes', `${shortHash(hash)} · ${detail.message.split('\n')[0]}`, entries);
  } catch (error) {
    services.output.warn(`vscode.changes failed: ${error instanceof Error ? error.message : String(error)}`);
    await vscode.commands.executeCommand('vscode.diff', entries[0][1], entries[0][2], `${shortHash(hash)} · ${detail.files[0].path}`);
  }
}

export function registerScmViews(context: vscode.ExtensionContext, services: Services): vscode.Disposable {
  let lastFileEditor = vscode.window.activeTextEditor?.document.uri.scheme === 'file'
    ? vscode.window.activeTextEditor
    : vscode.window.visibleTextEditors.find((editor) => editor.document.uri.scheme === 'file');
  const rememberEditor = (editor: vscode.TextEditor | undefined) => {
    if (editor?.document.uri.scheme === 'file') {
      lastFileEditor = editor;
    }
  };

  const currentFileEditor = () => lastFileEditor
    ?? vscode.window.visibleTextEditors.find((editor) => editor.document.uri.scheme === 'file');
  const file = new FileHistoryProvider(services, currentFileEditor);
  const line = new LineHistoryProvider(services, currentFileEditor);
  const commits = new CommitsProvider(services, context.workspaceState);

  const fileView = vscode.window.createTreeView('gitStudio.scm.fileHistory', { treeDataProvider: file });
  const lineView = vscode.window.createTreeView('gitStudio.scm.lineHistory', { treeDataProvider: line });
  const commitsView = vscode.window.createTreeView('gitStudio.scm.commits', { treeDataProvider: commits });
  file.attach(fileView);
  line.attach(lineView);
  commits.attach(commitsView);

  let repoBinding: vscode.Disposable | undefined;
  const bindRepo = () => {
    repoBinding?.dispose();
    const handle = services.repoService.active();
    if (!handle) {
      return;
    }
    repoBinding = vscode.Disposable.from(
      handle.repo.onDidCommit(() => scheduleAll()),
      handle.repo.onDidCheckout(() => scheduleAll())
    );
  };

  const refreshAll = () => {
    void file.refresh();
    void line.refresh();
    void commits.refresh();
  };
  const scheduleAll = debounce(refreshAll, 350);
  const scheduleLine = debounce(() => void line.refresh(false), 350);

  const openCommit = vscode.commands.registerCommand('gitStudio.scm.openCommit', async (repoRoot: string, hash: string, filePath?: string) => {
    const handle = services.repoService.list().find((entry) => entry.root === repoRoot) ?? await services.repoService.pick();
    if (!handle) {
      return;
    }
    await openCommitView(services, handle, hash, filePath);
  });

  const commands = [
    openCommit,
    vscode.commands.registerCommand('gitStudio.scm.fileHistory.refresh', () => file.refresh()),
    vscode.commands.registerCommand('gitStudio.scm.lineHistory.refresh', () => line.refresh()),
    vscode.commands.registerCommand('gitStudio.scm.commits.refresh', () => commits.refresh()),
    vscode.commands.registerCommand('gitStudio.scm.commits.toggleMerges', () => commits.toggleMerges()),
    vscode.commands.registerCommand('gitStudio.scm.commits.filter', () => commits.pickFilter()),
    vscode.commands.registerCommand('gitStudio.scm.commits.loadMore', () => commits.loadMore()),
    vscode.commands.registerCommand('gitStudio.scm.commits.clearFilters', () => commits.clearFilters())
  ];

  const disposables = [
    fileView,
    lineView,
    commitsView,
    ...commands,
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      rememberEditor(editor);
      bindRepo();
      void file.refresh();
      void line.refresh();
    }),
    vscode.window.onDidChangeTextEditorSelection((event) => {
      rememberEditor(event.textEditor);
      scheduleLine();
    }),
    services.repoService.onDidChangeRepositories(() => {
      bindRepo();
      scheduleAll();
    }),
    { dispose: () => repoBinding?.dispose() }
  ];

  void services.repoService.ensureActive().then(() => {
    bindRepo();
    refreshAll();
  });

  return vscode.Disposable.from(...disposables);
}
