import * as vscode from 'vscode';
import { loadCommits } from '../git/log';
import { layoutGraph } from '../graph/layout';
import { headOid } from '../git/write';
import type { Services } from '../host/services';
import { repoFor } from './diffs';

async function saveFile(defaultName: string, filters: Record<string, string[]>, content: string): Promise<void> {
  const target = await vscode.window.showSaveDialog({
    defaultUri: vscode.Uri.file(defaultName),
    filters,
    saveLabel: 'Save'
  });
  if (!target) {
    return;
  }
  await vscode.workspace.fs.writeFile(target, Buffer.from(content, 'utf8'));
  void vscode.window.showInformationMessage(`Git Studio: wrote ${target.fsPath}.`);
}

export async function exportPatch(services: Services, uri?: vscode.Uri): Promise<void> {
  const repo = await repoFor(services, uri);
  if (!repo) {
    return;
  }
  const range = await vscode.window.showInputBox({
    title: 'Export patch',
    prompt: 'A commit or range, for example HEAD~3..HEAD',
    value: 'HEAD~1..HEAD',
    ignoreFocusOut: true
  });
  if (!range?.trim()) {
    return;
  }
  try {
    const patch = await services.runner.run(['diff', '--binary', range.trim()], repo.root);
    await saveFile(`${repo.name}.patch`, { Patch: ['patch', 'diff'] }, patch);
  } catch (error) {
    void vscode.window.showErrorMessage(`Git Studio: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function applyPatch(services: Services, uri?: vscode.Uri): Promise<void> {
  const repo = await repoFor(services, uri);
  if (!repo) {
    return;
  }
  const picked = await vscode.window.showOpenDialog({
    canSelectMany: false,
    openLabel: 'Apply patch',
    filters: { Patch: ['patch', 'diff'] }
  });
  if (!picked?.[0]) {
    return;
  }
  const patch = await vscode.workspace.fs.readFile(picked[0]);
  try {
    const expected = await headOid(services.runner, repo.root);
    await services.writes.run(repo.root, expected, () =>
      services.runner.run(['apply', '--3way', '--whitespace=nowarn', '-'], repo.root, { input: Buffer.from(patch).toString('utf8') })
    );
    await repo.repo.status().catch(() => undefined);
    await vscode.commands.executeCommand('gitStudio.refresh');
  } catch (error) {
    void vscode.window.showErrorMessage(`Git Studio: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function exportGraph(services: Services, uri?: vscode.Uri): Promise<void> {
  const repo = await repoFor(services, uri);
  if (!repo) {
    return;
  }
  const result = await loadCommits(services.runner, repo.root, {
    refs: [],
    order: 'date',
    skip: 0,
    limit: 500
  });
  const graph = layoutGraph(result.rows);
  const rowHeight = 26;
  const laneGap = 14;
  const width = Math.max(320, 200 + Math.max(0, ...graph.map((row) => row.lane)) * laneGap);
  const height = Math.max(rowHeight, result.rows.length * rowHeight);
  const lines = graph.flatMap((row, index) =>
    row.segments.map((segment) => {
      const x1 = 20 + segment.from * laneGap;
      const x2 = 20 + segment.to * laneGap;
      const y1 = index * rowHeight + rowHeight / 2;
      const y2 = y1 + rowHeight;
      return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#888" stroke-width="2"/>`;
    })
  );
  const dots = graph.map((row, index) => {
    const x = 20 + row.lane * laneGap;
    const y = index * rowHeight + rowHeight / 2;
    return `<circle cx="${x}" cy="${y}" r="4" fill="#4a9eff"/>`;
  });
  const labels = result.rows.map((row, index) => {
    const x = 20 + (Math.max(0, ...graph.map((entry) => entry.lane)) + 1) * laneGap + 12;
    const y = index * rowHeight + rowHeight / 2 + 4;
    const text = `${row.shortHash} ${row.subject}`.replace(/[<>&]/g, '');
    return `<text x="${x}" y="${y}" font-family="monospace" font-size="12" fill="#ccc">${text}</text>`;
  });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="#1e1e1e"/>${lines.join('')}${dots.join('')}${labels.join('')}</svg>`;
  await saveFile(`${repo.name}-history.svg`, { SVG: ['svg'] }, svg);
}
