import * as vscode from 'vscode';
import type { GitRunner } from '../git/cli';
import type { WriteCoordinator } from '../git/write';
import type { RepoService } from './repoService';

export interface Services {
  repoService: RepoService;
  runner: GitRunner;
  writes: WriteCoordinator;
  output: vscode.LogOutputChannel;
  extensionUri: vscode.Uri;
}
