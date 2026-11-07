import * as vscode from 'vscode';
import { loadBlame, type BlameLine } from '../git/blame';
import type { RepoHandle } from '../host/repoService';
import type { Services } from '../host/services';

interface CachedBlame {
  key: string;
  lines: BlameLine[];
}

interface Applied {
  type: vscode.TextEditorDecorationType;
  key: string;
}

const MAX_LINES = 20000;
const CACHE_LIMIT = 30;

function ago(seconds: number): string {
  const delta = Math.max(0, Date.now() / 1000 - seconds);
  if (delta < 60) return 'now';
  if (delta < 3600) return `${Math.floor(delta / 60)}m ago`;
  if (delta < 86400) return `${Math.floor(delta / 3600)}h ago`;
  if (delta < 86400 * 30) return `${Math.floor(delta / 86400)}d ago`;
  if (delta < 86400 * 365) return `${Math.floor(delta / (86400 * 30))}mo ago`;
  return `${Math.floor(delta / (86400 * 365))}y ago`;
}

function renderTemplate(template: string, line: BlameLine): string {
  return template
    .replaceAll('${authorName}', line.author)
    .replaceAll('${authorEmail}', line.authorMail)
    .replaceAll('${authorDate}', new Date(line.authorTime * 1000).toLocaleString())
    .replaceAll('${authorDateAgo}', ago(line.authorTime))
    .replaceAll('${summary}', line.summary)
    .replaceAll('${shortHash}', line.hash.slice(0, 7));
}

export class AnnotateController implements vscode.Disposable {
  private readonly applied = new Map<string, Applied>();
  private readonly cache = new Map<string, CachedBlame>();
  private readonly overrides = new Map<string, boolean>();
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private readonly disposables: vscode.Disposable[] = [];

  constructor(private readonly services: Services) {
    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (editor) {
          void this.refresh(editor);
        }
      }),
      vscode.window.onDidChangeVisibleTextEditors((editors) => {
        for (const editor of editors) {
          void this.refresh(editor);
        }
      }),
      vscode.workspace.onDidSaveTextDocument((document) => {
        const editor = vscode.window.visibleTextEditors.find((candidate) => candidate.document === document);
        if (editor) {
          void this.refresh(editor, true);
        }
      }),
      vscode.workspace.onDidChangeTextDocument((event) => {
        if (event.contentChanges.length > 0 && this.isEnabled(event.document)) {
          this.schedule(event.document);
        }
      }),
      vscode.workspace.onDidCloseTextDocument((document) => {
        this.hide(document.uri);
        this.cache.delete(document.uri.toString());
      })
    );
  }

  isEnabled(document: vscode.TextDocument): boolean {
    const override = this.overrides.get(document.uri.toString());
    if (override !== undefined) {
      return override;
    }
    return vscode.workspace.getConfiguration('gitStudio').get<boolean>('annotate.enabled', false);
  }

  async toggle(editor: vscode.TextEditor): Promise<void> {
    const key = editor.document.uri.toString();
    this.overrides.set(key, !this.isEnabled(editor.document));
    if (this.isEnabled(editor.document)) {
      await this.refresh(editor, true);
    } else {
      this.hide(editor.document.uri);
    }
  }

  async show(editor: vscode.TextEditor): Promise<void> {
    this.overrides.set(editor.document.uri.toString(), true);
    await this.refresh(editor, true);
  }

  async refreshActive(): Promise<void> {
    if (vscode.window.activeTextEditor) {
      await this.refresh(vscode.window.activeTextEditor, true);
    }
  }

  async refresh(editor: vscode.TextEditor, force = false): Promise<void> {
    const document = editor.document;
    if (!this.isEnabled(document) || document.uri.scheme !== 'file') {
      this.hide(document.uri);
      return;
    }

    await this.services.repoService.ensureActive();
    const repo = this.services.repoService.forUri(document.uri);
    if (!repo) {
      this.hide(document.uri);
      return;
    }
    const relative = this.services.repoService.relativePath(repo, document.uri);
    if (!relative) {
      this.hide(document.uri);
      return;
    }
    if (document.isDirty) {
      return;
    }
    if (document.lineCount > MAX_LINES) {
      this.hide(document.uri);
      this.services.output.warn(`annotate skipped: ${relative} has ${document.lineCount} lines`);
      return;
    }

    let key: string;
    try {
      const stat = await vscode.workspace.fs.stat(document.uri);
      key = `${relative}:${stat.mtime}:${stat.size}:${document.version}`;
    } catch {
      key = `${relative}:${document.version}`;
    }

    const current = this.applied.get(document.uri.toString());
    if (!force && current?.key === key) {
      return;
    }

    const lines = await this.blame(repo, relative, key);
    if (!lines) {
      return;
    }

    try {
      const template = vscode.workspace
        .getConfiguration('gitStudio')
        .get<string>('annotate.template', '${authorName} · ${authorDateAgo} · ${summary}');
      const decorations: vscode.DecorationOptions[] = [];

      for (const line of lines) {
        const lineIndex = Math.min(Math.max(0, line.line - 1), Math.max(0, document.lineCount - 1));
        const textLine = document.lineAt(lineIndex);
        const range = new vscode.Range(lineIndex, textLine.text.length, lineIndex, textLine.text.length);
        const hover = new vscode.MarkdownString();
        hover.isTrusted = true;
        hover.appendMarkdown(`**${line.hash.slice(0, 7)}** · ${line.author} · ${new Date(line.authorTime * 1000).toLocaleString()}\n\n`);
        hover.appendText(line.summary || '(no subject)');
        hover.appendMarkdown(
          `\n\n[Open commit](command:gitStudio.openCommit?${encodeURIComponent(JSON.stringify([line.hash]))})`
        );
        decorations.push({
          range,
          hoverMessage: hover,
          renderOptions: {
            after: {
              contentText: `  ${renderTemplate(template, line)}`,
              color: new vscode.ThemeColor('editorCodeLens.foreground')
            }
          }
        });
      }

      const type = current?.type ?? vscode.window.createTextEditorDecorationType({
        rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
        after: { margin: '0 0 0 1.5em' }
      });
      editor.setDecorations(type, decorations);
      this.applied.set(document.uri.toString(), { type, key });
    } catch (error) {
      this.services.output.error(`annotate failed for ${relative}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async blame(repo: RepoHandle, relative: string, key: string): Promise<BlameLine[] | undefined> {
    const cached = this.cache.get(`${repo.root}:${relative}`);
    if (cached?.key === key) {
      return cached.lines;
    }

    const ignoreWhitespace = vscode.workspace
      .getConfiguration('gitStudio')
      .get<boolean>('annotate.ignoreWhitespace', true);
    try {
      const lines = await loadBlame(
        this.services.runner,
        repo.root,
        relative,
        { ignoreWhitespace, detectMoves: true }
      );
      this.cache.set(`${repo.root}:${relative}`, { key, lines });
      if (this.cache.size > CACHE_LIMIT) {
        const oldest = this.cache.keys().next().value;
        if (oldest) {
          this.cache.delete(oldest);
        }
      }
      return lines;
    } catch (error) {
      this.services.output.error(`blame failed for ${relative}: ${error instanceof Error ? error.message : String(error)}`);
      return undefined;
    }
  }

  private schedule(document: vscode.TextDocument): void {
    const key = document.uri.toString();
    const existing = this.timers.get(key);
    if (existing) {
      clearTimeout(existing);
    }
    this.timers.set(
      key,
      setTimeout(() => {
        this.timers.delete(key);
        const editor = vscode.window.visibleTextEditors.find((candidate) => candidate.document === document);
        if (editor) {
          void this.refresh(editor, true);
        }
      }, 2000)
    );
  }

  private hide(uri: vscode.Uri): void {
    const applied = this.applied.get(uri.toString());
    if (applied) {
      applied.type.dispose();
      this.applied.delete(uri.toString());
    }
  }

  dispose(): void {
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
    for (const applied of this.applied.values()) {
      applied.type.dispose();
    }
    this.applied.clear();
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
  }
}
