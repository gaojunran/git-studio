import * as vscode from 'vscode';
import type { CommitDetail, RebasePlan } from '../../shared/protocol';
import { loadWorktreeFiles } from '../git/diff';
import { buildRebasePlan } from '../git/rebase';
import { commitUrl, pickRemoteUrl } from '../git/remote';
import { detectOperation, headOid, isConflict, type Operation } from '../git/write';
import type { RepoHandle } from './repoService';
import type { Services } from './services';
import { emptyUri, gitUri, worktreeUri } from './uris';

type ActionId =
  | 'branch'
  | 'tag'
  | 'checkout'
  | 'worktree'
  | 'remote'
  | 'copy-subject'
  | 'copy-hash'
  | 'reset'
  | 'revert'
  | 'cherry-pick'
  | 'rebase'
  | 'abort';

interface ActionItem extends vscode.QuickPickItem {
  id?: ActionId;
}

function shortHash(hash: string): string {
  return hash.slice(0, 7);
}

function mainlineOf(detail: CommitDetail | undefined): number | undefined {
  return detail && detail.parents.length > 1 ? 1 : undefined;
}

export class CommitActionRunner {
  private busy = false;

  constructor(
    private readonly services: Services,
    private readonly getRepo: () => RepoHandle,
    private readonly onChanged: () => Promise<void>,
    private readonly onRebasePlan: (plan: RebasePlan) => void
  ) {}

  async show(hash: string, detail: CommitDetail | undefined): Promise<void> {
    const repo = this.getRepo();
    const operation = await detectOperation(this.services.runner, repo.root).catch(() => null);

    const items: ActionItem[] = [
      { id: 'branch', label: '$(git-branch) Create Branch Here…' },
      { id: 'tag', label: '$(tag) Create Tag Here…' },
      { id: 'checkout', label: '$(debug-disconnect) Checkout Commit (Detached)…' },
      { kind: vscode.QuickPickItemKind.Separator, label: 'Rewrite' },
      { id: 'reset', label: '$(discard) Reset Current Branch to Here…' },
      { id: 'revert', label: '$(history) Revert Commit…' },
      { id: 'cherry-pick', label: '$(git-commit) Cherry-pick onto Current Branch…' },
      { id: 'rebase', label: '$(git-pull-request) Interactively Rebase from Here…' }
    ];

    if (operation) {
      items.push(
        { kind: vscode.QuickPickItemKind.Separator, label: 'In progress' },
        { id: 'abort', label: `$(debug-stop) Abort ${operation}…` }
      );
    }

    items.push(
      { kind: vscode.QuickPickItemKind.Separator, label: '' },
      { id: 'worktree', label: '$(diff) Compare with Working Tree' },
      { id: 'remote', label: '$(globe) Open Commit on Remote' },
      { id: 'copy-subject', label: '$(copy) Copy Commit Subject' },
      { id: 'copy-hash', label: '$(copy) Copy Commit Hash' }
    );

    const picked = await vscode.window.showQuickPick(items, {
      placeHolder: `Commit ${shortHash(hash)}${detail?.message.split('\n')[0] ? ` · ${detail.message.split('\n')[0]}` : ''}`
    });
    if (!picked?.id) {
      return;
    }

    await this.run(picked.id, hash, detail);
  }

  private async run(action: ActionId, hash: string, detail: CommitDetail | undefined): Promise<void> {
    if (this.busy) {
      void vscode.window.showInformationMessage('Git Studio: another commit action is still running.');
      return;
    }

    this.busy = true;
    try {
      switch (action) {
        case 'branch':
          await this.createBranch(hash);
          break;
        case 'tag':
          await this.createTag(hash);
          break;
        case 'checkout':
          await this.checkout(hash);
          break;
        case 'worktree':
          await this.compareWithWorktree(hash);
          break;
        case 'remote':
          await this.openOnRemote(hash);
          break;
        case 'copy-subject':
          await vscode.env.clipboard.writeText(detail?.message.split('\n')[0] ?? '');
          break;
        case 'copy-hash':
          await vscode.env.clipboard.writeText(hash);
          break;
        case 'reset':
          await this.reset(hash);
          break;
        case 'revert':
          await this.revert(hash, detail);
          break;
        case 'cherry-pick':
          await this.cherryPick(hash, detail);
          break;
        case 'rebase':
          await this.openRebase(hash);
          break;
        case 'abort':
          await this.abort();
          break;
      }
    } catch (error) {
      if (isConflict(error)) {
        await this.onChanged();
        await this.reportConflict(error);
        return;
      }
      void vscode.window.showErrorMessage(
        `Git Studio: ${error instanceof Error ? error.message : String(error)}`
      );
    } finally {
      this.busy = false;
    }
  }

  private async createBranch(hash: string): Promise<void> {
    const repo = this.getRepo();
    const suggestion = await repo.repo.generateRandomBranchName?.();
    const name = await vscode.window.showInputBox({
      prompt: `Create and checkout a branch at ${shortHash(hash)}`,
      value: suggestion ?? '',
      validateInput: (value) => (value.trim() ? undefined : 'Branch name is required')
    });
    if (!name) {
      return;
    }

    await repo.repo.createBranch(name.trim(), true, hash);
    await this.onChanged();
  }

  private async createTag(hash: string): Promise<void> {
    const repo = this.getRepo();
    const name = await vscode.window.showInputBox({
      prompt: `Create a tag at ${shortHash(hash)}`,
      validateInput: (value) => (value.trim() ? undefined : 'Tag name is required')
    });
    if (!name) {
      return;
    }

    const message = await vscode.window.showInputBox({
      prompt: 'Tag message',
      placeHolder: 'Leave empty for a lightweight tag'
    });
    if (message === undefined) {
      return;
    }

    const args = ['tag'];
    if (message.trim()) {
      args.push('-a', '-m', message.trim());
    }
    args.push(name.trim(), hash);

    await this.services.runner.run(args, repo.root);
    await repo.repo.status();
    await this.onChanged();
  }

  private async checkout(hash: string): Promise<void> {
    const repo = this.getRepo();
    const answer = await vscode.window.showWarningMessage(
      `Checkout ${shortHash(hash)}? HEAD will be detached from any branch.`,
      { modal: true },
      'Checkout'
    );
    if (answer !== 'Checkout') {
      return;
    }

    if (typeof repo.repo.checkout === 'function') {
      await repo.repo.checkout(hash);
    } else {
      await this.services.runner.run(['checkout', '--detach', hash], repo.root);
      await repo.repo.status();
    }
    await this.onChanged();
  }

  private async compareWithWorktree(hash: string): Promise<void> {
    const repo = this.getRepo();
    const files = await loadWorktreeFiles(this.services.runner, repo.root, hash);
    if (files.length === 0) {
      void vscode.window.showInformationMessage(`Git Studio: working tree matches ${shortHash(hash)}.`);
      return;
    }

    const entries = files.map((file): [vscode.Uri, vscode.Uri, vscode.Uri] => {
      const worktree = worktreeUri(repo, file.path);
      const oldPath = file.oldPath ?? file.path;
      const left = file.status === 'A' ? emptyUri(oldPath) : gitUri(this.services, repo, oldPath, hash);
      const right = file.status === 'D' ? emptyUri(file.path) : worktree;
      return [worktree, left, right];
    });

    await vscode.commands.executeCommand(
      'vscode.changes',
      `${shortHash(hash)} ↔ Working Tree`,
      entries
    );
  }

  private async reset(hash: string): Promise<void> {
    const repo = this.getRepo();
    const head = await headOid(this.services.runner, repo.root);
    const branch = repo.repo.state.HEAD?.name ?? 'HEAD';

    const mode = await vscode.window.showQuickPick(
      [
        { label: 'Soft', description: 'Move HEAD only; keep changes staged', value: 'soft' as const },
        { label: 'Mixed', description: 'Move HEAD; keep changes unstaged', value: 'mixed' as const },
        { label: 'Hard', description: 'Move HEAD and discard tracked changes', value: 'hard' as const }
      ],
      { placeHolder: `Reset ${branch} to ${shortHash(hash)}` }
    );
    if (!mode) {
      return;
    }

    if (mode.value === 'hard') {
      const answer = await vscode.window.showWarningMessage(
        `Hard reset ${branch} to ${shortHash(hash)}? Tracked changes will be discarded (untracked files are kept).`,
        { modal: true },
        'Hard Reset'
      );
      if (answer !== 'Hard Reset') {
        return;
      }
    }

    await this.services.writes.reset(repo.root, hash, mode.value, head);
    await this.record(`reset (${mode.value})`, head);
    await this.onChanged();
    void vscode.window.showInformationMessage(`Git Studio: reset ${branch} to ${shortHash(hash)} (${mode.value}).`);
  }

  private async revert(hash: string, detail: CommitDetail | undefined): Promise<void> {
    const repo = this.getRepo();
    const head = await headOid(this.services.runner, repo.root);
    const answer = await vscode.window.showWarningMessage(
      `Revert ${shortHash(hash)}? This creates a new commit on ${repo.repo.state.HEAD?.name ?? 'HEAD'}.`,
      { modal: true },
      'Revert'
    );
    if (answer !== 'Revert') {
      return;
    }

    await this.services.writes.revert(repo.root, hash, head, mainlineOf(detail));
    await this.record(`revert ${shortHash(hash)}`, head);
    await this.onChanged();
    void vscode.window.showInformationMessage(`Git Studio: reverted ${shortHash(hash)}.`);
  }

  private async cherryPick(hash: string, detail: CommitDetail | undefined): Promise<void> {
    const repo = this.getRepo();
    const head = await headOid(this.services.runner, repo.root);
    const branch = repo.repo.state.HEAD?.name ?? 'HEAD';
    const answer = await vscode.window.showWarningMessage(
      `Cherry-pick ${shortHash(hash)} onto ${branch}?`,
      { modal: true },
      'Cherry-pick'
    );
    if (answer !== 'Cherry-pick') {
      return;
    }

    await this.services.writes.cherryPick(repo.root, hash, head, mainlineOf(detail));
    await this.record(`cherry-pick ${shortHash(hash)}`, head);
    await this.onChanged();
    void vscode.window.showInformationMessage(`Git Studio: cherry-picked ${shortHash(hash)} onto ${branch}.`);
  }

  private async abort(): Promise<void> {
    const repo = this.getRepo();
    const operation = await detectOperation(this.services.runner, repo.root);
    if (!operation) {
      return;
    }

    const answer = await vscode.window.showWarningMessage(
      `Abort the ${operation} in progress?`,
      { modal: true },
      'Abort'
    );
    if (answer !== 'Abort') {
      return;
    }

    await this.services.writes.abort(repo.root);
    await this.onChanged();
    void vscode.window.showInformationMessage(`Git Studio: aborted ${operation}.`);
  }

  private async openRebase(hash: string): Promise<void> {
    const repo = this.getRepo();
    const plan = await buildRebasePlan(this.services.runner, repo.root, hash);
    this.onRebasePlan(plan);
  }

  private async record(label: string, before: string | undefined): Promise<void> {
    if (!before) {
      return;
    }
    const repo = this.getRepo();
    const after = await headOid(this.services.runner, repo.root);
    if (!after || after === before) {
      return;
    }
    await this.services.journal.record(repo.root, {
      label,
      before,
      after,
      branch: repo.repo.state.HEAD?.name ?? null,
      at: Date.now()
    });
  }

  private async reportConflict(error: unknown): Promise<void> {
    const repo = this.getRepo();
    const operation: Operation = await detectOperation(this.services.runner, repo.root).catch(() => null);
    const firstLine = error instanceof Error ? error.message.split('\n')[0] : String(error);

    const choice = await vscode.window.showWarningMessage(
      `Git Studio: ${operation ?? 'Operation'} stopped with conflicts. ${firstLine}`,
      'Show Conflicts',
      'Abort'
    );
    if (choice === 'Show Conflicts') {
      await vscode.commands.executeCommand('workbench.view.scm');
    } else if (choice === 'Abort') {
      await this.services.writes.abort(repo.root);
      await this.onChanged();
    }
  }

  private async openOnRemote(hash: string): Promise<void> {
    const repo = this.getRepo();
    const remote = pickRemoteUrl(repo.repo.state.remotes);
    const template = vscode.workspace.getConfiguration('gitStudio').get<string>('remote.commitUrlTemplate', '');
    const url = remote ? commitUrl(remote, hash, template) : undefined;
    if (!url) {
      void vscode.window.showInformationMessage('Git Studio: no supported remote URL for this commit.');
      return;
    }
    await vscode.env.openExternal(vscode.Uri.parse(url));
  }
}
