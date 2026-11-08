import * as vscode from 'vscode';
import * as path from 'node:path';
import type { RepoSummary } from '../../shared/protocol';

export interface GitHead {
  readonly name?: string;
  readonly commit?: string;
  readonly upstream?: { readonly name: string };
  readonly ahead?: number;
  readonly behind?: number;
}

export interface GitRepositoryLike {
  readonly rootUri: vscode.Uri;
  readonly kind?: string;
  readonly state: {
    readonly HEAD?: GitHead;
    readonly remotes: { readonly name: string; readonly fetchUrl?: string; readonly pushUrl?: string }[];
    readonly onDidChange: vscode.Event<void>;
  };
  readonly ui?: { readonly selected: boolean };
  status(): Promise<void>;
  readonly onDidCommit: vscode.Event<void>;
  readonly onDidCheckout: vscode.Event<void>;
  checkout(treeish: string): Promise<void>;
  createBranch(name: string, checkout: boolean, ref?: string): Promise<void>;
  generateRandomBranchName?(): Promise<string | undefined>;
}

export interface GitApiLike {
  readonly git: { readonly path: string };
  readonly repositories: GitRepositoryLike[];
  readonly onDidOpenRepository: vscode.Event<GitRepositoryLike>;
  getRepository(uri: vscode.Uri): GitRepositoryLike | undefined;
  toGitUri(uri: vscode.Uri, ref: string): vscode.Uri;
}

interface GitExtensionLike {
  readonly enabled: boolean;
  getAPI(version: 1): GitApiLike;
}

export interface RepoHandle {
  repo: GitRepositoryLike;
  root: string;
  name: string;
  kind: string;
}

export class RepoService {
  private api: GitApiLike | undefined;
  private extension: vscode.Extension<GitExtensionLike> | undefined;
  private repoListener: vscode.Disposable | undefined;
  private repoChangeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeRepositories = this.repoChangeEmitter.event;

  async initialize(): Promise<void> {
    this.extension = vscode.extensions.getExtension<GitExtensionLike>('vscode.git');
    if (!this.extension) {
      return;
    }
    // Do not activate the built-in Git extension here. Activating it makes VS Code
    // scan the whole repository, which on a huge repository freezes the window.
    // Commands that need the API call ensureActive() first.
    if (this.extension.isActive) {
      this.attach(this.extension.exports);
    }
  }

  async ensureActive(): Promise<boolean> {
    if (this.api) {
      return true;
    }
    if (!this.extension) {
      this.extension = vscode.extensions.getExtension<GitExtensionLike>('vscode.git');
    }
    if (!this.extension) {
      return false;
    }
    try {
      this.attach(await this.extension.activate());
      return this.api !== undefined;
    } catch {
      return false;
    }
  }

  private attach(exports: GitExtensionLike | undefined): void {
    if (!exports?.enabled) {
      return;
    }
    try {
      this.api = exports.getAPI(1);
      this.repoListener?.dispose();
      this.repoListener = this.api.onDidOpenRepository(() => this.repoChangeEmitter.fire());
    } catch {
      this.api = undefined;
    }
  }

  get available(): boolean {
    return this.api !== undefined;
  }

  get gitPath(): string {
    const configured = vscode.workspace.getConfiguration('gitStudio').get<string>('git.path', '').trim();
    return configured || this.api?.git.path || 'git';
  }

  list(): RepoHandle[] {
    const repos = this.api?.repositories ?? [];
    const counts = new Map<string, number>();
    for (const repo of repos) {
      const name = path.basename(repo.rootUri.fsPath);
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }

    return repos.map((repo) => {
      const base = path.basename(repo.rootUri.fsPath);
      const name = (counts.get(base) ?? 0) > 1
        ? `${path.basename(path.dirname(repo.rootUri.fsPath))}/${base}`
        : base;
      return { repo, root: repo.rootUri.fsPath, name, kind: repo.kind ?? 'repository' };
    });
  }

  forUri(uri: vscode.Uri): RepoHandle | undefined {
    const repo = this.api?.getRepository(uri);
    if (!repo) {
      return undefined;
    }
    const root = repo.rootUri.toString();
    return this.list().find((candidate) => candidate.repo.rootUri.toString() === root);
  }

  /** Repository selected in the built-in Source Control view. */
  selected(): RepoHandle | undefined {
    return this.list().find((handle) => handle.repo.ui?.selected);
  }

  /** Active editor's repository, then the SCM-selected repository, then the only repository. */
  active(): RepoHandle | undefined {
    const editor = vscode.window.activeTextEditor;
    if (editor) {
      const fromEditor = this.forUri(editor.document.uri);
      if (fromEditor) {
        return fromEditor;
      }
    }
    const selected = this.selected();
    if (selected) {
      return selected;
    }
    const repos = this.list();
    return repos.length === 1 ? repos[0] : undefined;
  }

  async pick(uri?: vscode.Uri): Promise<RepoHandle | undefined> {
    await this.ensureActive();
    const fromUri = uri ? this.forUri(uri) : undefined;
    if (fromUri) {
      return fromUri;
    }

    const auto = this.active();
    if (auto) {
      return auto;
    }

    const repos = this.list();
    if (repos.length === 0) {
      return undefined;
    }
    if (repos.length === 1) {
      return repos[0];
    }

    const picked = await vscode.window.showQuickPick(
      repos.map((handle) => ({
        label: handle.name,
        description: handle.kind,
        detail: handle.root,
        handle
      })),
      { placeHolder: 'Select a repository' }
    );
    return picked?.handle;
  }

  summary(handle: RepoHandle): RepoSummary {
    const head = handle.repo.state.HEAD;
    return {
      name: handle.name,
      root: handle.root,
      kind: handle.kind,
      branch: head?.name ?? null,
      detached: Boolean(head && !head.name)
    };
  }

  toGitUri(uri: vscode.Uri, ref: string): vscode.Uri {
    if (!this.api) {
      throw new Error('Git extension is not available');
    }
    return this.api.toGitUri(uri, ref);
  }

  relativePath(handle: RepoHandle, uri: vscode.Uri): string | undefined {
    const relative = path.relative(handle.root, uri.fsPath);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
      return undefined;
    }
    return relative.split(path.sep).join('/');
  }

  dispose(): void {
    this.repoListener?.dispose();
    this.repoChangeEmitter.dispose();
  }
}
