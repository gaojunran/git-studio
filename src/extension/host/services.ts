import * as vscode from 'vscode';
import type { GitRunner } from '../git/cli';
import type { WriteCoordinator } from '../git/write';
import type { Journal } from './journal';
import type { RepoService } from './repoService';

export interface AnnotateLike {
  show(editor: vscode.TextEditor): Promise<void>;
}

export interface Services {
  repoService: RepoService;
  runner: GitRunner;
  writes: WriteCoordinator;
  journal: Journal;
  output: vscode.LogOutputChannel;
  extensionUri: vscode.Uri;
  annotate?: AnnotateLike;
}
