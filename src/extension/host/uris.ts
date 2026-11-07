import * as vscode from 'vscode';
import type { RepoHandle } from './repoService';
import type { Services } from './services';

export const EMPTY_SCHEME = 'gitstudio-empty';

export function emptyUri(filePath: string): vscode.Uri {
  return vscode.Uri.from({ scheme: EMPTY_SCHEME, path: `/${filePath}` });
}

export function worktreeUri(repo: RepoHandle, filePath: string): vscode.Uri {
  return vscode.Uri.joinPath(repo.repo.rootUri, filePath);
}

export function gitUri(services: Services, repo: RepoHandle, filePath: string, ref: string): vscode.Uri {
  return services.repoService.toGitUri(worktreeUri(repo, filePath), ref);
}
