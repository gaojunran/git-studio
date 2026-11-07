import * as vscode from 'vscode';
import type { GitRunner } from '../git/cli';
import type { RepoService } from './repoService';

export interface Services {
  repoService: RepoService;
  runner: GitRunner;
  output: vscode.LogOutputChannel;
  extensionUri: vscode.Uri;
}
