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
    readonly onDidChange: vscode.Event<void>;
  };
  toGitUri(uri: vscode.Uri, ref: string): vscode.Uri;
  status(): Promise<void>;
}

export interface GitApiLike {
  readonly git: { readonly path: string };
  readonly repositories: GitRepositoryLike[];
  readonly onDidOpenRepository: vscode.Event<GitRepositoryLike>;
  getRepository(uri: vscode.Uri): GitRepositoryLike | undefined;
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
  private repoChangeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeRepositories = this.repoChangeEmitter.event;

  async initialize(): Promise<void> {
    const extension = vscode.extensions.getExtension<GitExtensionLike>('vscode.git');
    if (!extension) {
      return;
    }

    try {
      const exports = extension.isActive ? extension.exports : await extension.activate();
      if (!exports?.enabled) {
        return;
      }
      this.api = exports.getAPI(1);
      this.api.onDidOpenRepository(() => this.repoChangeEmitter.fire());
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
    return repo ? this.list().find((candidate) => candidate.repo === repo) : undefined;
  }

  async pick(uri?: vscode.Uri): Promise<RepoHandle | undefined> {
    const fromUri = uri ? this.forUri(uri) : undefined;
    if (fromUri) {
      return fromUri;
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

  relativePath(handle: RepoHandle, uri: vscode.Uri): string | undefined {
    const relative = path.relative(handle.root, uri.fsPath);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
      return undefined;
    }
    return relative.split(path.sep).join('/');
  }

  dispose(): void {
    this.repoChangeEmitter.dispose();
  }
}
