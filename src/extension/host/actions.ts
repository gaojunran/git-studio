import * as vscode from 'vscode';
import type { CommitDetail } from '../../shared/protocol';
import { loadWorktreeFiles } from '../git/diff';
import { commitUrl, pickRemoteUrl } from '../git/remote';
import type { RepoHandle } from './repoService';
import type { Services } from './services';
import { emptyUri, gitUri, worktreeUri } from './uris';

type ActionId = 'branch' | 'tag' | 'checkout' | 'worktree' | 'remote' | 'copy-subject' | 'copy-hash';

interface ActionItem extends vscode.QuickPickItem {
  id: ActionId;
}

function shortHash(hash: string): string {
  return hash.slice(0, 7);
}

export class CommitActionRunner {
  private busy = false;

  constructor(
    private readonly services: Services,
    private readonly getRepo: () => RepoHandle,
    private readonly refresh: () => Promise<void>
  ) {}

  async show(hash: string, detail: CommitDetail | undefined): Promise<void> {
    const items: ActionItem[] = [
      { id: 'branch', label: '$(git-branch) Create Branch Here…' },
      { id: 'tag', label: '$(tag) Create Tag Here…' },
      { id: 'checkout', label: '$(debug-disconnect) Checkout Commit (Detached)…' },
      { id: 'worktree', label: '$(diff) Compare with Working Tree' },
      { id: 'remote', label: '$(globe) Open Commit on Remote' },
      { id: 'copy-subject', label: '$(copy) Copy Commit Subject' },
      { id: 'copy-hash', label: '$(copy) Copy Commit Hash' }
    ];

    const picked = await vscode.window.showQuickPick(items, {
      placeHolder: `Commit ${shortHash(hash)}${detail?.message.split('\n')[0] ? ` · ${detail.message.split('\n')[0]}` : ''}`
    });
    if (!picked) {
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
      }
    } catch (error) {
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
    await this.refresh();
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
    await this.refresh();
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
    await this.refresh();
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

  private async openOnRemote(hash: string): Promise<void> {
    const repo = this.getRepo();
    const remote = pickRemoteUrl(repo.repo.state.remotes);
    const url = remote ? commitUrl(remote, hash) : undefined;
    if (!url) {
      void vscode.window.showInformationMessage('Git Studio: no supported remote URL for this commit.');
      return;
    }
    await vscode.env.openExternal(vscode.Uri.parse(url));
  }
}
