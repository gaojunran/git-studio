import * as vscode from 'vscode';
import * as path from 'node:path';
import type { SidebarFile, SidebarMessage, SidebarState } from '../../shared/sidebar';
import { detectOperation, headOid, isConflict } from '../git/write';
import { loadRefs } from '../git/refs';
import { renderSidebarHtml } from '../host/html';
import type { RepoHandle } from '../host/repoService';
import type { Services } from '../host/services';
import { parseStatus } from './status';

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class SidebarProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  static readonly viewType = 'gitStudio.sidebar';

  private view?: vscode.WebviewView;
  private root: string | null = null;
  private readonly messages = new Map<string, string>();
  private readonly disposables: vscode.Disposable[] = [];
  private refreshTimer: NodeJS.Timeout | undefined;
  private repoSubscription: vscode.Disposable | undefined;
  private boundRoot: string | null = null;
  private emptyRetries = 0;
  private busy = false;

  constructor(private readonly services: Services) {
    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor(() => {
        if (!this.view?.visible) {
          return;
        }
        const handle = this.activeHandle();
        if (handle && handle.root !== this.root && !this.busy) {
          this.root = handle.root;
          void this.refresh();
        }
      })
    );
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.services.extensionUri, 'dist', 'sidebar')]
    };
    view.webview.html = renderSidebarHtml(view.webview, this.services.extensionUri);
    this.disposables.push(
      view.webview.onDidReceiveMessage((message: SidebarMessage) => void this.onMessage(message)),
      view.onDidChangeVisibility(() => {
        if (view.visible) {
          void this.refresh();
        }
      })
    );
    void this.refresh();
  }

  dispose(): void {
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.repoSubscription?.dispose();
    this.disposables.length = 0;
  }

  private activeHandle(): RepoHandle | undefined {
    return this.services.repoService.active() ?? this.services.repoService.list()[0];
  }

  private handle(): RepoHandle | undefined {
    const repos = this.services.repoService.list();
    return repos.find((candidate) => candidate.root === this.root) ?? this.activeHandle();
  }

  private async onMessage(message: SidebarMessage): Promise<void> {
    try {
      switch (message.type) {
        case 'ready':
        case 'refresh':
          await this.refresh();
          return;
        case 'selectRepo':
          this.root = message.root;
          await this.refresh();
          return;
        case 'stage':
          await this.stage(message.paths);
          return;
        case 'unstage':
          await this.unstage(message.paths);
          return;
        case 'discard':
          await this.discard(message.paths);
          return;
        case 'stageAll':
          await this.stageAll();
          return;
        case 'unstageAll':
          await this.unstageAll();
          return;
        case 'discardAll':
          await this.discardAll();
          return;
        case 'openDiff':
          await this.openDiff(message.path, message.staged, message.conflict);
          return;
        case 'openFile':
          await this.openFile(message.path);
          return;
        case 'reveal':
          await vscode.commands.executeCommand('revealInExplorer', this.uri(message.path));
          return;
        case 'copyPath':
          await vscode.env.clipboard.writeText(message.path);
          this.post({ type: 'toast', message: 'Path copied' });
          return;
        case 'commit':
          await this.commit(message);
          return;
        case 'pickBranch':
          await this.pickBranch();
          return;
        case 'createBranch':
          await this.createBranch();
          return;
        case 'renameBranch':
          await this.renameBranch();
          return;
        case 'deleteBranch':
          await this.deleteBranch();
          return;
        case 'sync':
          await this.sync(message.action, message.rebase);
          return;
        case 'operation':
          await this.operation(message.action);
          return;
        case 'stash':
          await this.stash(message.mode);
          return;
        case 'openStashes':
          await vscode.commands.executeCommand('gitStudio.stashWorkbench');
          return;
        case 'openWorktrees':
          await vscode.commands.executeCommand('gitStudio.worktreeWorkbench');
          return;
        case 'openHistory':
          await vscode.commands.executeCommand('gitStudio.openHistory');
          return;
        case 'openBoard':
          await vscode.commands.executeCommand('gitStudio.openBoard');
          return;
      }
    } catch (error) {
      this.services.output.error(`sidebar: ${errorText(error)}`);
      this.post({ type: 'error', message: errorText(error) });
    }
  }

  private uri(filePath: string): vscode.Uri {
    const handle = this.handle();
    return handle ? vscode.Uri.joinPath(handle.repo.rootUri, filePath) : vscode.Uri.file(filePath);
  }

  private post(message: Parameters<vscode.Webview['postMessage']>[0]): void {
    void this.view?.webview.postMessage(message);
  }

  private async refresh(): Promise<void> {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = undefined;
    }
    if (!this.services.repoService.available) {
      await this.services.repoService.ensureActive();
    }
    const handle = this.handle();
    if (!handle) {
      if (this.emptyRetries++ < 5) {
        this.refreshTimer = setTimeout(() => {
          this.refreshTimer = undefined;
          void this.refresh();
        }, 600);
      }
      return;
    }
    this.emptyRetries = 0;
    this.root = handle.root;
    if (this.boundRoot !== handle.root) {
      this.repoSubscription?.dispose();
      this.boundRoot = handle.root;
      this.repoSubscription = handle.repo.state.onDidChange(() => this.scheduleRefresh());
    }
    try {
      const state = await this.buildState(handle);
      this.post({ type: 'state', state });
    } catch (error) {
      this.services.output.error(`sidebar refresh: ${errorText(error)}`);
      this.post({ type: 'error', message: errorText(error) });
    }
  }

  private scheduleRefresh(): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
    }
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = undefined;
      void this.refresh();
    }, 300);
  }

  private async buildState(handle: RepoHandle): Promise<SidebarState> {
    const root = handle.root;
    const [statusText, statsText, operation] = await Promise.all([
      this.services.runner.run(['status', '--porcelain=v2', '--branch', '-z', '--untracked-files=all'], root),
      this.services.runner.run(['diff', '--numstat', 'HEAD'], root).catch(() => ''),
      detectOperation(this.services.runner, root).catch(() => null)
    ]);
    const parsed = parseStatus(statusText);
    const files = this.applyStats(parsed.files, statsText);
    const summary = this.services.repoService.summary(handle);
    const state: SidebarState = {
      repo: summary,
      repos: this.services.repoService.list().map((candidate) => this.services.repoService.summary(candidate)),
      files,
      branch: parsed.branch,
      detached: parsed.branch === null && parsed.oid !== '',
      upstream: parsed.upstream,
      ahead: parsed.ahead,
      behind: parsed.behind,
      operation: operation
        ? {
            kind: operation as 'merge' | 'rebase' | 'cherry-pick' | 'revert' | 'bisect' | 'unknown',
            canContinue: operation !== 'merge',
            canSkip: operation === 'rebase' || operation === 'cherry-pick' || operation === 'revert'
          }
        : null,
      commitMessage: this.messages.get(root) ?? ''
    };
    return state;
  }

  private applyStats(files: SidebarFile[], output: string): SidebarFile[] {
    const stats = new Map<string, { additions: number; deletions: number }>();
    for (const line of output.split('\n')) {
      const [additions, deletions, filePath] = line.split('\t');
      if (!filePath) {
        continue;
      }
      stats.set(filePath, {
        additions: additions === '-' ? 0 : Number(additions) || 0,
        deletions: deletions === '-' ? 0 : Number(deletions) || 0
      });
    }
    return files.map((file) => ({ ...file, ...(stats.get(file.path) ?? {}) }));
  }

  private async stage(paths: string[]): Promise<void> {
    const handle = this.handle();
    if (!handle || paths.length === 0) {
      return;
    }
    await this.busyRun(async () => {
      await this.services.writes.command(handle.root, ['add', '-A', '--', ...paths], await headOid(this.services.runner, handle.root));
      await this.refresh();
    });
  }

  private async unstage(paths: string[]): Promise<void> {
    const handle = this.handle();
    if (!handle || paths.length === 0) {
      return;
    }
    await this.busyRun(async () => {
      await this.services.writes.command(handle.root, ['reset', '-q', 'HEAD', '--', ...paths], await headOid(this.services.runner, handle.root));
      await this.refresh();
    });
  }

  private async discard(paths: string[]): Promise<void> {
    const handle = this.handle();
    if (!handle || paths.length === 0) {
      return;
    }
    const answer = await vscode.window.showWarningMessage(
      `Discard changes in ${paths.length} file${paths.length === 1 ? '' : 's'}?`,
      { modal: true },
      'Discard'
    );
    if (answer !== 'Discard') {
      return;
    }
    await this.busyRun(async () => {
      const head = await headOid(this.services.runner, handle.root);
      const state = parseStatus(await this.services.runner.run(['status', '--porcelain=v2', '--branch', '-z', '--untracked-files=all'], handle.root));
      const untracked = state.files.filter((file) => file.status === '?').map((file) => file.path);
      const untrackedPaths = paths.filter((filePath) => untracked.includes(filePath));
      const trackedPaths = paths.filter((filePath) => !untracked.includes(filePath));
      if (trackedPaths.length > 0) {
        await this.services.writes.command(handle.root, ['restore', '--staged', '--worktree', '--', ...trackedPaths], head);
      }
      if (untrackedPaths.length > 0) {
        await this.services.writes.command(handle.root, ['clean', '-f', '--', ...untrackedPaths], head);
      }
      await this.refresh();
    });
  }

  private async stageAll(): Promise<void> {
    const handle = this.handle();
    if (!handle) {
      return;
    }
    await this.busyRun(async () => {
      await this.services.writes.command(handle.root, ['add', '-A'], await headOid(this.services.runner, handle.root));
      await this.refresh();
    });
  }

  private async unstageAll(): Promise<void> {
    const handle = this.handle();
    if (!handle) {
      return;
    }
    await this.busyRun(async () => {
      await this.services.writes.command(handle.root, ['reset', '-q', 'HEAD'], await headOid(this.services.runner, handle.root));
      await this.refresh();
    });
  }

  private async discardAll(): Promise<void> {
    const handle = this.handle();
    if (!handle) {
      return;
    }
    const answer = await vscode.window.showWarningMessage(
      'Discard every tracked change in this repository? Untracked files are kept.',
      { modal: true },
      'Discard All'
    );
    if (answer !== 'Discard All') {
      return;
    }
    await this.busyRun(async () => {
      await this.services.writes.command(handle.root, ['restore', '--staged', '--worktree', '--', '.'], await headOid(this.services.runner, handle.root));
      await this.refresh();
    });
  }

  private async openDiff(filePath: string, staged: boolean, conflict?: boolean): Promise<void> {
    const handle = this.handle();
    if (!handle) {
      return;
    }
    const file = vscode.Uri.joinPath(handle.repo.rootUri, filePath);
    if (conflict) {
      try {
        await vscode.commands.executeCommand('git.openMergeEditor', file);
        return;
      } catch {
        await vscode.commands.executeCommand('vscode.open', file, { preview: true });
        return;
      }
    }
    const left = this.services.repoService.toGitUri(file, 'HEAD');
    const right = staged ? this.services.repoService.toGitUri(file, '') : file;
    await vscode.commands.executeCommand(
      'vscode.diff',
      left,
      right,
      `${path.basename(filePath)} (${staged ? 'Staged' : 'Changes'})`,
      { viewColumn: vscode.ViewColumn.Beside, preview: true }
    );
  }

  private async openFile(filePath: string): Promise<void> {
    await vscode.commands.executeCommand('vscode.open', this.uri(filePath), { preview: true });
  }

  private async commit(message: Extract<SidebarMessage, { type: 'commit' }>): Promise<void> {
    const handle = this.handle();
    if (!handle) {
      return;
    }
    const text = message.message.trim();
    if (!text) {
      this.post({ type: 'error', message: 'Commit message is required.' });
      return;
    }
    await this.busyRun(async () => {
      const head = await headOid(this.services.runner, handle.root);
      if (message.mode === 'all') {
        await this.services.writes.command(handle.root, ['add', '-A'], head);
      }
      const args = ['commit', '-m', text];
      if (message.amend) {
        args.push('--amend');
      }
      await this.services.writes.command(handle.root, args, head);
      if (message.push) {
        await this.push(handle);
      }
      this.messages.delete(handle.root);
      this.post({ type: 'toast', message: message.amend ? 'Commit amended' : 'Committed' });
      await this.refresh();
    });
  }

  private async push(handle: RepoHandle): Promise<void> {
    const upstream = await this.services.runner
      .run(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'], handle.root)
      .then((value) => value.trim())
      .catch(() => '');
    const branch = await this.services.runner
      .run(['symbolic-ref', '--short', '-q', 'HEAD'], handle.root)
      .then((value) => value.trim())
      .catch(() => '');
    if (!branch) {
      throw new Error('Cannot push a detached HEAD.');
    }
    if (upstream) {
      await this.services.writes.command(handle.root, ['push'], await headOid(this.services.runner, handle.root));
    } else {
      await this.services.writes.command(
        handle.root,
        ['push', '-u', 'origin', branch],
        await headOid(this.services.runner, handle.root)
      );
    }
  }

  private async pickBranch(): Promise<void> {
    const handle = this.handle();
    if (!handle) {
      return;
    }
    const refs = await loadRefs(this.services.runner, handle.root);
    const current = await this.services.runner
      .run(['symbolic-ref', '--short', '-q', 'HEAD'], handle.root)
      .then((value) => value.trim())
      .catch(() => '');
    const picked = await vscode.window.showQuickPick(
      refs
        .filter((ref) => ref.type !== 'tag')
        .map((ref) => ({
          label: ref.current ? `$(check) ${ref.shortName}` : ref.shortName,
          description: ref.type === 'remote' ? 'remote' : ref.upstream ? `→ ${ref.upstream}` : '',
          ref
        })),
      { title: 'Switch branch', placeHolder: current || 'Detached HEAD' }
    );
    if (!picked) {
      return;
    }
    const ref = picked.ref;
    await this.busyRun(async () => {
      if (ref.type === 'remote') {
        const local = ref.shortName.split('/').slice(1).join('/');
        await this.services.writes.command(handle.root, ['checkout', '-b', local, '--track', ref.shortName], await headOid(this.services.runner, handle.root));
      } else {
        await this.services.writes.command(handle.root, ['checkout', ref.shortName], await headOid(this.services.runner, handle.root));
      }
      await this.refresh();
    });
  }

  private async createBranch(): Promise<void> {
    const handle = this.handle();
    if (!handle) {
      return;
    }
    const name = await vscode.window.showInputBox({ prompt: 'New branch name' });
    if (!name?.trim()) {
      return;
    }
    await this.busyRun(async () => {
      await this.services.writes.command(handle.root, ['checkout', '-b', name.trim()], await headOid(this.services.runner, handle.root));
      await this.refresh();
    });
  }

  private async renameBranch(): Promise<void> {
    const handle = this.handle();
    if (!handle) {
      return;
    }
    const current = await this.services.runner
      .run(['symbolic-ref', '--short', '-q', 'HEAD'], handle.root)
      .then((value) => value.trim())
      .catch(() => '');
    if (!current) {
      this.post({ type: 'error', message: 'Detached HEAD has no branch to rename.' });
      return;
    }
    const name = await vscode.window.showInputBox({ prompt: `Rename ${current} to`, value: current });
    if (!name?.trim() || name.trim() === current) {
      return;
    }
    await this.busyRun(async () => {
      await this.services.writes.command(handle.root, ['branch', '-m', current, name.trim()], await headOid(this.services.runner, handle.root));
      await this.refresh();
    });
  }

  private async deleteBranch(): Promise<void> {
    const handle = this.handle();
    if (!handle) {
      return;
    }
    const current = await this.services.runner
      .run(['symbolic-ref', '--short', '-q', 'HEAD'], handle.root)
      .then((value) => value.trim())
      .catch(() => '');
    const refs = await loadRefs(this.services.runner, handle.root);
    const picked = await vscode.window.showQuickPick(
      refs
        .filter((ref) => ref.type === 'local' && ref.shortName !== current)
        .map((ref) => ({ label: ref.shortName, ref })),
      { title: 'Delete branch' }
    );
    if (!picked) {
      return;
    }
    const answer = await vscode.window.showWarningMessage(`Delete ${picked.label}?`, { modal: true }, 'Delete');
    if (answer !== 'Delete') {
      return;
    }
    await this.busyRun(async () => {
      await this.services.writes.command(handle.root, ['branch', '-d', picked.ref.shortName], await headOid(this.services.runner, handle.root));
      await this.refresh();
    });
  }

  private async sync(action: 'fetch' | 'pull' | 'push' | 'publish', rebase?: boolean): Promise<void> {
    const handle = this.handle();
    if (!handle) {
      return;
    }
    await this.busyRun(async () => {
      const head = await headOid(this.services.runner, handle.root);
      if (action === 'fetch') {
        await this.services.writes.command(handle.root, ['fetch', '--all', '--prune'], head);
      } else if (action === 'pull') {
        await this.services.writes.command(handle.root, ['pull', rebase ? '--rebase' : '--ff-only'], head);
      } else if (action === 'push') {
        await this.push(handle);
      } else {
        const branch = await this.services.runner
          .run(['symbolic-ref', '--short', '-q', 'HEAD'], handle.root)
          .then((value) => value.trim())
          .catch(() => '');
        if (!branch) {
          throw new Error('Cannot publish a detached HEAD.');
        }
        await this.services.writes.command(handle.root, ['push', '-u', 'origin', branch], head);
      }
      await this.refresh();
    });
  }

  private async operation(action: 'continue' | 'skip' | 'abort'): Promise<void> {
    const handle = this.handle();
    if (!handle) {
      return;
    }
    await this.busyRun(async () => {
      if (action === 'continue') {
        await this.services.writes.continueOperation(handle.root);
      } else if (action === 'skip') {
        await this.services.writes.skipOperation(handle.root);
      } else {
        await this.services.writes.abort(handle.root);
      }
      await this.refresh();
    });
  }

  private async stash(mode: 'all' | 'staged' | 'untracked'): Promise<void> {
    const handle = this.handle();
    if (!handle) {
      return;
    }
    await this.busyRun(async () => {
      const head = await headOid(this.services.runner, handle.root);
      if (mode === 'staged') {
        await this.services.writes.command(handle.root, ['stash', 'push', '--staged'], head);
      } else if (mode === 'untracked') {
        const state = parseStatus(await this.services.runner.run(['status', '--porcelain=v2', '--branch', '-z', '--untracked-files=all'], handle.root));
        const untracked = state.files.filter((file) => file.status === '?').map((file) => file.path);
        if (untracked.length === 0) {
          throw new Error('There are no untracked files to stash.');
        }
        await this.services.writes.command(handle.root, ['stash', 'push', '--include-untracked', '--', ...untracked], head);
      } else {
        await this.services.writes.command(handle.root, ['stash', 'push', '--include-untracked'], head);
      }
      this.post({ type: 'toast', message: 'Stashed' });
      await this.refresh();
    });
  }

  private async busyRun(task: () => Promise<void>): Promise<void> {
    if (this.busy) {
      this.post({ type: 'error', message: 'Another operation is still running.' });
      return;
    }
    this.busy = true;
    this.post({ type: 'busy', busy: true });
    try {
      await task();
    } catch (error) {
      if (isConflict(error)) {
        this.post({ type: 'error', message: 'Conflict: resolve it in the editor, then continue or abort.' });
      } else {
        this.post({ type: 'error', message: errorText(error) });
      }
    } finally {
      this.busy = false;
      this.post({ type: 'busy', busy: false });
    }
  }
}
