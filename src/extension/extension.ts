import * as vscode from 'vscode';
import { GitRunner } from './git/cli';
import { WriteCoordinator } from './git/write';
import { AnnotateController } from './features/annotate';
import { BoardPanel } from './board/panel';
import { connectIntegration, installIntegration, installIntegrationFromArchive, installIntegrationFromGit, removeIntegration, updateIntegration } from './board/commands';
import { createBoardContext } from './board/service';
import { compareWorkingTree } from './features/compare';
import {
  compareFileRevisions,
  compareFolder,
  compareIncoming,
  compareMergeBase,
  compareRefs,
  compareRefsMergeBase,
  compareRemoteTracking,
  compareStash,
  compareTagPrevious,
  compareUnpushed
} from './features/diffs';
import { worktreeWorkbench } from './features/worktree';
import { applyPatch, exportGraph, exportPatch } from './features/export';
import { compareReflogEntry, reflogUndo, reflogWorkbench } from './features/reflog';
import { HistoryPanel } from './host/historyPanel';
import { stashWorkbench } from './features/stash';
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

let activeBoard: ReturnType<typeof createBoardContext> | undefined;


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

function urisFromArg(arg: unknown): vscode.Uri[] {
  const values = Array.isArray(arg) ? arg : [arg];
  return values.flatMap((value) => {
    if (value instanceof vscode.Uri) {
      return [value];
    }
    const uri = uriFromArg(value);
    return uri ? [uri] : [];
  });
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
  const board = createBoardContext(context, output);
  activeBoard = board;

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

    vscode.commands.registerCommand('gitStudio.openBoard', async (arg?: unknown) => {
      const uri = uriFromArg(arg) ?? vscode.window.activeTextEditor?.document.uri;
      await BoardPanel.show(services, context.secrets, board, { uri });
    }),

    vscode.commands.registerCommand('gitStudio.boardOpenItem', async (arg: { uri?: vscode.Uri; providerId?: string; kind: 'issue' | 'pull' | 'discussion'; number: number }) => {
      const uri = arg.uri ?? vscode.window.activeTextEditor?.document.uri;
      await BoardPanel.show(services, context.secrets, board, {
        uri,
        focus: { providerId: arg.providerId, kind: arg.kind, number: arg.number }
      });
    }),

    vscode.commands.registerCommand('gitStudio.boardFindCommitItems', async (arg: { root: string; sha: string }) =>
      BoardPanel.findCommitItems(services, context.secrets, arg.root, arg.sha)
    ),

    vscode.commands.registerCommand('gitStudio.boardInstallIntegration', async (arg?: { folder?: string; instance?: string; token?: string; login?: string }) => {
      await installIntegration(board, arg ?? {});
    }),

    vscode.commands.registerCommand('gitStudio.boardInstallIntegrationFromGit', async (arg?: { url?: string; instance?: string; token?: string; login?: string }) => {
      await installIntegrationFromGit(board, arg ?? {});
    }),

    vscode.commands.registerCommand('gitStudio.boardInstallIntegrationFromArchive', async (arg?: { archive?: string; instance?: string; token?: string; login?: string }) => {
      await installIntegrationFromArchive(board, arg ?? {});
    }),

    vscode.commands.registerCommand('gitStudio.boardUpdateIntegration', async () => {
      await updateIntegration(board);
    }),

    vscode.commands.registerCommand('gitStudio.boardConnectIntegration', async () => {
      await connectIntegration(board);
    }),

    vscode.commands.registerCommand('gitStudio.boardRemoveIntegration', async () => {
      await removeIntegration(board);
    }),

    vscode.commands.registerCommand('gitStudio.boardConnectGithub', async () => {
      await BoardPanel.connectGithub(context.secrets);
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

    vscode.commands.registerCommand('gitStudio.folderHistory', async (arg?: unknown) => {
      const uri = uriFromArg(arg) ?? vscode.window.activeTextEditor?.document.uri;
      const repo = await repoService.pick(uri);
      if (!repo) {
        void vscode.window.showWarningMessage('Git Studio: no Git repository found in this workspace.');
        return;
      }
      const relative = uri ? repoService.relativePath(repo, uri) : undefined;
      if (!relative) {
        void vscode.window.showWarningMessage('Git Studio: select a folder inside the repository.');
        return;
      }
      await HistoryPanel.show(services, { repo, paths: [relative] });
    }),
    vscode.commands.registerCommand('gitStudio.multiPathHistory', async (arg?: unknown) => {
      const uris = urisFromArg(arg);
      const repo = await repoService.pick(uris[0] ?? vscode.window.activeTextEditor?.document.uri);
      if (!repo) {
        void vscode.window.showWarningMessage('Git Studio: no Git repository found in this workspace.');
        return;
      }
      const paths = uris
        .map((uri) => repoService.relativePath(repo, uri))
        .filter((value): value is string => Boolean(value));
      if (paths.length === 0) {
        void vscode.window.showWarningMessage('Git Studio: select files or folders inside the repository.');
        return;
      }
      await HistoryPanel.show(services, { repo, paths });
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

    vscode.commands.registerCommand('gitStudio.diffRefsMergeBase', async (arg?: unknown) => {
      const { uri, options } = splitCompareArg(arg);
      await compareRefsMergeBase(services, uri, options.left, options.right);
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

    vscode.commands.registerCommand('gitStudio.exportPatch', (arg?: unknown) => exportPatch(services, uriFromArg(arg))),
    vscode.commands.registerCommand('gitStudio.applyPatch', (arg?: unknown) => applyPatch(services, uriFromArg(arg))),
    vscode.commands.registerCommand('gitStudio.exportGraph', (arg?: unknown) => exportGraph(services, uriFromArg(arg))),
    vscode.commands.registerCommand('gitStudio.diffReflog', (arg?: unknown) => compareReflogEntry(services, uriFromArg(arg))),
    vscode.commands.registerCommand('gitStudio.worktreeWorkbench', (arg?: unknown) => worktreeWorkbench(services, uriFromArg(arg))),
    vscode.commands.registerCommand('gitStudio.reflogWorkbench', (arg?: unknown) => reflogWorkbench(services, uriFromArg(arg))),
    vscode.commands.registerCommand('gitStudio.reflogUndo', (arg?: unknown) => reflogUndo(services, uriFromArg(arg))),
    vscode.commands.registerCommand('gitStudio.stashWorkbench', (arg?: unknown) => stashWorkbench(services, uriFromArg(arg))),
    vscode.commands.registerCommand('gitStudio.diffIncoming', async (arg?: unknown) => compareIncoming(services, uriFromArg(arg))),
    vscode.commands.registerCommand('gitStudio.diffTagPrevious', async (arg?: unknown) => compareTagPrevious(services, uriFromArg(arg))),
    vscode.commands.registerCommand('gitStudio.diffRemoteTracking', async (arg?: unknown) => compareRemoteTracking(services, uriFromArg(arg))),
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

export async function deactivate(): Promise<void> {
  await activeBoard?.guestService.dispose();
}
