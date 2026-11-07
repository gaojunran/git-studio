import * as vscode from 'vscode';
import { GitRunner } from './git/cli';
import { WriteCoordinator } from './git/write';
import { AnnotateController } from './features/annotate';
import { compareWorkingTree } from './features/compare';
import {
  compareFileRevisions,
  compareFolder,
  compareMergeBase,
  compareRefs,
  compareStash,
  compareUnpushed
} from './features/diffs';
import { HistoryPanel } from './host/historyPanel';
import { Journal } from './host/journal';
import { RepoService } from './host/repoService';
import type { Services } from './host/services';

interface ScmResourceArg {
  resourceUri?: vscode.Uri;
  resource?: { resourceUri?: vscode.Uri };
}

interface CompareArg {
  uri?: vscode.Uri;
  left?: string;
  right?: string;
  ref?: string;
  stash?: string;
  current?: string;
}

function splitCompareArg(arg: unknown): { uri?: vscode.Uri; options: CompareArg } {
  if (arg instanceof vscode.Uri) {
    return { uri: arg, options: {} };
  }
  if (typeof arg === 'string') {
    return { uri: undefined, options: { ref: arg } };
  }
  if (arg && typeof arg === 'object') {
    const options = arg as CompareArg;
    return { uri: options.uri ?? uriFromArg(arg), options };
  }
  return { uri: undefined, options: {} };
}

function uriFromArg(arg: unknown): vscode.Uri | undefined {
  const first = Array.isArray(arg) ? arg[0] : arg;
  if (!first) {
    return undefined;
  }
  if (first instanceof vscode.Uri) {
    return first;
  }
  const candidate = first as ScmResourceArg;
  return candidate.resourceUri ?? candidate.resource?.resourceUri;
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const output = vscode.window.createOutputChannel('Git Studio', { log: true });
  const repoService = new RepoService();
  await repoService.initialize();

  const runner = new GitRunner(repoService.gitPath, (line) => output.debug(line));
  const writes = new WriteCoordinator(runner);
  const journal = new Journal(context.workspaceState);
  const services: Services = {
    repoService,
    runner,
    writes,
    journal,
    output,
    extensionUri: context.extensionUri
  };
  const annotate = new AnnotateController(services);

  const updateContext = () => {
    void vscode.commands.executeCommand('setContext', 'gitStudio.hasRepo', repoService.list().length > 0);
  };
  updateContext();

  context.subscriptions.push(
    output,
    repoService,
    annotate,
    repoService.onDidChangeRepositories(updateContext),
    vscode.workspace.registerTextDocumentContentProvider('gitstudio-empty', {
      provideTextDocumentContent: () => ''
    }),

    vscode.commands.registerCommand('gitStudio.openHistory', async (arg?: unknown) => {
      const uri = uriFromArg(arg) ?? vscode.window.activeTextEditor?.document.uri;
      await HistoryPanel.show(services, { repo: uri ? repoService.forUri(uri) : undefined });
    }),

    vscode.commands.registerCommand('gitStudio.fileHistory', async (arg?: unknown) => {
      const uri = uriFromArg(arg) ?? vscode.window.activeTextEditor?.document.uri;
      if (!uri) {
        void vscode.window.showWarningMessage('Git Studio: open a file to show its history.');
        return;
      }
      await HistoryPanel.show(services, { fileUri: uri });
    }),

    vscode.commands.registerCommand('gitStudio.annotateFile', async (arg?: unknown) => {
      const uri = uriFromArg(arg) ?? vscode.window.activeTextEditor?.document.uri;
      if (!uri) {
        void vscode.window.showWarningMessage('Git Studio: open a file to annotate it.');
        return;
      }
      try {
        const document = await vscode.workspace.openTextDocument(uri);
        const editor = await vscode.window.showTextDocument(document, { preview: true });
        await annotate.show(editor);
      } catch (error) {
        void vscode.window.showErrorMessage(`Git Studio: cannot open file for annotate: ${error instanceof Error ? error.message : String(error)}`);
      }
    }),

    vscode.commands.registerCommand('gitStudio.toggleAnnotate', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        void vscode.window.showWarningMessage('Git Studio: open a file to toggle annotate.');
        return;
      }
      await annotate.toggle(editor);
    }),

    vscode.commands.registerCommand('gitStudio.openCommit', async (hash?: string) => {
      if (!hash) {
        return;
      }
      await HistoryPanel.show(services, { focus: hash });
    }),

    vscode.commands.registerCommand('gitStudio.goToCommit', async () => {
      const input = await vscode.window.showInputBox({
        prompt: 'Commit hash, branch or tag',
        placeHolder: 'e.g. a1b2c3d or origin/main'
      });
      const revision = input?.trim();
      if (!revision) {
        return;
      }

      const handle = await repoService.pick(vscode.window.activeTextEditor?.document.uri);
      if (!handle) {
        void vscode.window.showWarningMessage('Git Studio: no Git repository found in this workspace.');
        return;
      }

      try {
        const full = (
          await runner.run(['rev-parse', '--verify', '--end-of-options', `${revision}^{commit}`], handle.root)
        ).trim();
        await HistoryPanel.show(services, { repo: handle, focus: full });
      } catch {
        void vscode.window.showErrorMessage(`Git Studio: unknown revision "${revision}".`);
      }
    }),

    vscode.commands.registerCommand('gitStudio.compareWorkingTree', async (arg?: unknown) => {
      const { uri, options } = splitCompareArg(arg);
      await compareWorkingTree(services, uri, options.ref);
    }),

    vscode.commands.registerCommand('gitStudio.diffRefs', async (arg?: unknown) => {
      const { uri, options } = splitCompareArg(arg);
      await compareRefs(services, uri, options.left, options.right);
    }),

    vscode.commands.registerCommand('gitStudio.diffMergeBase', async (arg?: unknown) => {
      const { uri, options } = splitCompareArg(arg);
      await compareMergeBase(services, uri, options.ref, options.current);
    }),

    vscode.commands.registerCommand('gitStudio.diffStash', async (arg?: unknown) => {
      const { uri, options } = splitCompareArg(arg);
      await compareStash(services, uri, options.stash);
    }),

    vscode.commands.registerCommand('gitStudio.diffFileRevisions', async (arg?: unknown) => {
      const { uri, options } = splitCompareArg(arg);
      await compareFileRevisions(services, uri, options.left, options.right);
    }),

    vscode.commands.registerCommand('gitStudio.diffFolder', async (arg?: unknown) => {
      const { uri, options } = splitCompareArg(arg);
      await compareFolder(services, uri, options.ref);
    }),

    vscode.commands.registerCommand('gitStudio.diffUnpushed', async (arg?: unknown) => {
      const { uri } = splitCompareArg(arg);
      await compareUnpushed(services, uri);
    }),

    vscode.commands.registerCommand('gitStudio.undoLastRewrite', async () => {
      await HistoryPanel.undoCurrent();
    }),

    vscode.commands.registerCommand('gitStudio.refresh', async () => {
      await HistoryPanel.refreshCurrent();
    }),

    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('gitStudio.git.path')) {
        runner.setGitPath(repoService.gitPath);
      }
      if (event.affectsConfiguration('gitStudio.annotate')) {
        void annotate.refreshActive();
      }
      if (event.affectsConfiguration('gitStudio.history')) {
        void HistoryPanel.refreshCurrent();
      }
    })
  );
}

export function deactivate(): void {
  // No workspace-level resources to release.
}
